import { clamp, lognormal, percentile, rng, type Rand } from "./rng";
import { fmt, type SimDef } from "./types";
import { Bars, LineChart, Note, Stats } from "./ui";

/* ------------------------------------------------------------------ payload formats */

type FormatP = { shape: "users" | "metrics" | "articles"; records: number; format: "json" | "json-short" | "msgpack" | "protobuf"; rps: number; linkMbps: number; egressUsdPerGB: number };

interface FormatR {
  bytes: Record<string, number>;
  responseBytes: number;
  transferMs: number;
  mbPerSec: number;
  usdPerMonth: number;
}

type Val = number | string | boolean;
type Rec = Record<string, Val>;

const utf8 = (s: string) => new TextEncoder().encode(s).length;
const WORDS = "the quick api returns small payloads over slow mobile links so every byte and round trip counts for users far away".split(" ");

function makeRecords(shape: FormatP["shape"], n: number): Rec[] {
  const r = rng(7);
  const word = () => WORDS[Math.floor(r() * WORDS.length)];
  return Array.from({ length: n }, (_, i): Rec => {
    if (shape === "users")
      return { id: 100000 + i, username: `${word()}_${Math.floor(r() * 999)}`, email: `${word()}${i}@example.com`, verified: r() < 0.7, followers: Math.floor(r() ** 3 * 50000), createdAt: 1730000000 + Math.floor(r() * 3e7) };
    if (shape === "metrics")
      return { sensorId: 5000 + (i % 40), ts: 1761600000 + i * 10, temperature: Math.round((18 + r() * 12) * 100) / 100, humidity: Math.round(r() * 1000) / 10, battery: Math.floor(r() * 100), ok: r() < 0.98 };
    return { id: 9000 + i, title: Array.from({ length: 6 }, word).join(" "), body: Array.from({ length: 60 }, word).join(" "), authorId: 100000 + Math.floor(r() * 5000), likes: Math.floor(r() ** 2 * 2000), published: true };
  });
}

/** Bytes for one value as MessagePack (the spec's smallest encoding for each value). */
function msgpackValue(v: Val): number {
  if (typeof v === "boolean") return 1;
  if (typeof v === "string") {
    const n = utf8(v);
    return n + (n < 32 ? 1 : n < 256 ? 2 : n < 65536 ? 3 : 5);
  }
  if (!Number.isInteger(v)) return 9; // float64
  const a = Math.abs(v);
  if (v >= 0 ? a < 128 : a <= 32) return 1;
  if (a < 256) return 2;
  if (a < 65536) return 3;
  return a < 4294967296 ? 5 : 9;
}
const msgpackLen = (n: number) => (n < 16 ? 1 : n < 65536 ? 3 : 5);

function varint(n: number): number {
  let b = 1;
  while (n >= 128) {
    n = Math.floor(n / 128);
    b++;
  }
  return b;
}

/** Bytes for one field as Protocol Buffers: a tag, then a varint, fixed64 or length-delimited value. */
function protoField(fieldNo: number, v: Val): number {
  const tag = varint(fieldNo << 3);
  if (typeof v === "boolean") return v ? tag + 1 : 0; // proto3 skips default values
  if (typeof v === "string") {
    const n = utf8(v);
    return n ? tag + varint(n) + n : 0;
  }
  if (!Number.isInteger(v)) return tag + 8; // double
  return v === 0 ? 0 : tag + varint(v >= 0 ? v * 2 : -v * 2 - 1); // sint64, zigzag
}

const SHORT: Record<string, string> = {};

export function encodedSizes(recs: Rec[]): Record<FormatP["format"], number> {
  const json = utf8(JSON.stringify({ items: recs }));
  const short = utf8(
    JSON.stringify({
      i: recs.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [(SHORT[k] ??= k.slice(0, 2)), v]))),
    }),
  );
  let mp = 1 + 6 + msgpackLen(recs.length); // {"items": [...]}
  for (const r of recs) {
    const keys = Object.keys(r);
    mp += keys.length < 16 ? 1 : 3;
    for (const k of keys) mp += msgpackValue(k) + msgpackValue(r[k]);
  }
  let pb = 0;
  for (const r of recs) {
    const body = Object.values(r).reduce<number>((s, v, i) => s + protoField(i + 1, v), 0);
    pb += 1 + varint(body) + body; // repeated message field 1
  }
  return { json, "json-short": short, msgpack: mp, protobuf: pb };
}

export function runFormats(p: FormatP): FormatR {
  const bytes = encodedSizes(makeRecords(p.shape, Math.max(1, Math.round(p.records))));
  const responseBytes = bytes[p.format] + 300; // HTTP/2 headers after HPACK, roughly
  const transferMs = ((responseBytes * 8) / (p.linkMbps * 1e6)) * 1000;
  const mbPerSec = (responseBytes * p.rps) / 1e6;
  const usdPerMonth = ((responseBytes * p.rps * 86400 * 30) / 1e9) * p.egressUsdPerGB;
  return { bytes, responseBytes, transferMs, mbPerSec, usdPerMonth };
}

const FORMAT_LABEL: Record<string, string> = { json: "JSON", "json-short": "JSON, short keys", msgpack: "MessagePack", protobuf: "Protobuf" };

export const payloadFormats: SimDef<FormatP, FormatR> = {
  id: "payload-formats",
  title: "Payload formats: JSON vs MessagePack vs Protobuf",
  module: 19,
  lessons: ["19.7", "20.5"],
  blurb: "Encodes real records in four formats, byte for byte, then turns the size into transfer time on a slow phone link and a monthly bandwidth bill.",
  params: [
    { key: "shape", label: "What the API returns", type: "select", options: [{ value: "users", label: "User profiles (ids, names, flags)" }, { value: "metrics", label: "Sensor readings (mostly numbers)" }, { value: "articles", label: "Articles (mostly text)" }] },
    { key: "records", label: "Records per response", type: "number", min: 1, max: 1000, log: true },
    { key: "format", label: "Format", type: "select", options: Object.entries(FORMAT_LABEL).map(([value, label]) => ({ value, label })) },
    { key: "rps", label: "Responses per second", type: "number", min: 10, max: 50000, log: true },
    { key: "linkMbps", label: "Client link speed", type: "number", min: 0.5, max: 100, step: 0.5, log: true, unit: "Mbps", hint: "A weak 4G signal gives a few Mbps." },
    { key: "egressUsdPerGB", label: "Cloud egress price", type: "number", min: 0.01, max: 0.15, step: 0.01, unit: "$/GB" },
  ],
  defaults: { shape: "metrics", records: 200, format: "json", rps: 2000, linkMbps: 2, egressUsdPerGB: 0.08 },
  run: runFormats,
  metrics: (r) => ({ bytes: r.responseBytes, transferMs: r.transferMs, usdPerMonth: r.usdPerMonth, mbPerSec: r.mbPerSec }),
  metricSpecs: [
    { key: "bytes", label: "Response size", format: (v) => fmt.kb(v / 1024) },
    { key: "transferMs", label: "Transfer time on the link", format: fmt.ms },
    { key: "mbPerSec", label: "Egress", format: (v) => `${v.toFixed(1)} MB/s` },
    { key: "usdPerMonth", label: "Egress bill", format: (v) => `$${fmt.n(v)}/mo` },
  ],
  View: ({ p, r }) => {
    const keys = Object.keys(FORMAT_LABEL) as FormatP["format"][];
    return (
      <>
        <Bars
          yLabel="KB per response"
          labels={keys.map((k) => FORMAT_LABEL[k])}
          values={keys.map((k) => r.bytes[k] / 1024)}
          color={(_, i) => (keys[i] === p.format ? "var(--accent)" : "var(--muted)")}
          yFormat={(v) => v.toFixed(v < 10 ? 1 : 0)}
        />
        <Note>
          Sizes are computed by encoding {Math.round(p.records)} real records with each format's rules (varints and field tags for Protobuf, type-tagged
          values for MessagePack). JSON repeats every field name in every record and writes numbers as text. Turning on gzip or Brotli narrows the gap a lot,
          because repeated keys compress well, but it costs CPU on both ends and does nothing for the client's parse time.
        </Note>
      </>
    );
  },
};

/* ------------------------------------------------------------------ fetch patterns */

type FetchP = { style: "rest" | "rest-expand" | "graphql" | "bff"; posts: number; rttMs: number; parallel: number; dataloader: boolean; fieldsUsedPct: number; dbMs: number };

interface FetchR {
  loadMs: number;
  rounds: number;
  requests: number;
  bytes: number;
  queries: number;
  phases: { name: string; ms: number }[];
}

const SERVER_MS = 8; // per request: routing, auth, serialisation
const FULL_POST = 1400; // bytes of a full post resource
const FULL_USER = 900;
const LINK_MBPS = 8;

/** One profile screen: the user, their latest posts, and each post's author card and like count. */
export function runFetch(p: FetchP): FetchR {
  const n = Math.max(1, Math.round(p.posts));
  const used = clamp(p.fieldsUsedPct / 100, 0.05, 1);
  const lanes = Math.max(1, Math.round(p.parallel));
  let rounds: number, requests: number, bytes: number, queries: number, serverMs: number;
  if (p.style === "rest") {
    // GET /users/1, then GET /users/1/posts, then GET /posts/:id/stats for each post (in waves of `lanes`).
    const waves = Math.ceil(n / lanes);
    rounds = 2 + waves;
    requests = 2 + n;
    bytes = FULL_USER + n * FULL_POST + n * 300 + requests * 200;
    queries = 1 + 1 + n;
    serverMs = rounds * (SERVER_MS + p.dbMs);
  } else if (p.style === "rest-expand") {
    // GET /users/1?include=posts.stats - one round trip, but whole resources come back.
    rounds = 1;
    requests = 1;
    bytes = FULL_USER + n * (FULL_POST + 300) + 200;
    queries = 3;
    serverMs = SERVER_MS + 3 * p.dbMs;
  } else if (p.style === "graphql") {
    rounds = 1;
    requests = 1;
    bytes = (FULL_USER + n * (FULL_POST + 300)) * used + 400;
    // Without batching, each post's resolver runs its own query: the N+1 problem.
    queries = p.dataloader ? 3 : 2 + n;
    const resolverWaves = p.dataloader ? 3 : 2 + Math.ceil(n / 4); // resolvers at the same depth run concurrently, but the pool is small
    serverMs = SERVER_MS + resolverWaves * p.dbMs + (p.dataloader ? 0 : n * 0.3);
  } else {
    // A backend-for-frontend calls the internal services in parallel over a fast network and returns exactly the screen.
    rounds = 1;
    requests = 1;
    bytes = (FULL_USER + n * (FULL_POST + 300)) * used + 300;
    queries = 3;
    serverMs = SERVER_MS + 2 * (1 + SERVER_MS + p.dbMs);
  }
  const networkMs = rounds * p.rttMs;
  const transferMs = ((bytes * 8) / (LINK_MBPS * 1e6)) * 1000;
  const phases = [
    { name: "round trips", ms: networkMs },
    { name: "server + DB", ms: serverMs },
    { name: "download", ms: transferMs },
  ];
  return { loadMs: networkMs + serverMs + transferMs, rounds, requests, bytes, queries, phases };
}

export const fetchPatterns: SimDef<FetchP, FetchR> = {
  id: "fetch-patterns",
  title: "REST vs GraphQL vs a BFF for one screen",
  module: 20,
  lessons: ["20.4", "20.6", "22.3"],
  blurb: "A mobile profile screen needs a user, their posts and stats for each post. Count round trips, bytes and database queries for chatty REST, expanded REST, GraphQL (with and without DataLoader) and a backend-for-frontend.",
  params: [
    { key: "style", label: "How the app fetches", type: "select", options: [{ value: "rest", label: "REST, one call per resource" }, { value: "rest-expand", label: "REST with ?include=" }, { value: "graphql", label: "GraphQL query" }, { value: "bff", label: "Backend-for-frontend endpoint" }] },
    { key: "posts", label: "Posts on the screen", type: "number", min: 1, max: 50 },
    { key: "rttMs", label: "Round-trip time to the API", type: "number", min: 10, max: 400, step: 10, unit: "ms", hint: "~30 ms on Wi-Fi near a region, 150-300 ms on a congested mobile network." },
    { key: "parallel", label: "Parallel requests (REST)", type: "number", min: 1, max: 20, hint: "HTTP/2 lets one connection carry many requests at once." },
    { key: "dataloader", label: "Batch resolvers with DataLoader (GraphQL)", type: "toggle" },
    { key: "fieldsUsedPct", label: "Fields the screen actually uses", type: "number", min: 5, max: 100, step: 5, unit: "%" },
    { key: "dbMs", label: "One database query", type: "number", min: 1, max: 20, unit: "ms" },
  ],
  defaults: { style: "rest", posts: 20, rttMs: 200, parallel: 1, dataloader: false, fieldsUsedPct: 30, dbMs: 4 },
  run: runFetch,
  metrics: (r) => ({ loadMs: r.loadMs, rounds: r.rounds, kb: r.bytes / 1024, queries: r.queries }),
  metricSpecs: [
    { key: "loadMs", label: "Screen load time", format: fmt.ms },
    { key: "rounds", label: "Sequential round trips", format: fmt.n },
    { key: "kb", label: "Bytes downloaded", format: (v) => fmt.kb(v) },
    { key: "queries", label: "Database queries", format: fmt.n },
  ],
  View: ({ p, r }) => (
    <>
      <Bars yLabel="ms" labels={r.phases.map((x) => x.name)} values={r.phases.map((x) => x.ms)} refLine={1000} refLabel="1 s: users notice" />
      <Stats
        items={[
          { label: "HTTP requests", value: fmt.n(r.requests) },
          { label: "Round trips in a row", value: fmt.n(r.rounds), tone: r.rounds > 3 ? "bad" : "good" },
          { label: "DB queries", value: fmt.n(r.queries), tone: r.queries > 10 ? "warm" : undefined },
        ]}
      />
      <Note>
        {p.style === "rest"
          ? "Each wave of requests costs a full round trip, and the stats calls can't start until the posts list arrives. On a slow network, latency is dominated by how many trips happen one after another, not by bytes."
          : p.style === "graphql" && !p.dataloader
            ? "One round trip for the client, but each post's resolver queries the database on its own: 1 query for the list plus 1 per post. DataLoader collects those calls and makes one batched query per level."
            : "One round trip. The remaining cost is server work and the download; trimming fields matters most on slow links."}
      </Note>
    </>
  ),
};

/* ------------------------------------------------------------------ pagination */

type PageP = { mode: "offset" | "cursor"; pageSize: number; pages: number; insertsPerPage: number; deletesPerPage: number; tableRows: number };

interface PageR {
  seen: number;
  duplicates: number;
  missed: number;
  rowsScannedLast: number;
  lastPageMs: number;
  perPageMs: number[];
}

/** A user scrolls a newest-first feed while new items arrive at the top and old ones get deleted. */
export function runPagination(p: PageP): PageR {
  const r = rng(11);
  const size = Math.max(1, Math.round(p.pageSize));
  const pages = Math.max(1, Math.round(p.pages));
  const ins = Math.round(p.insertsPerPage);
  const dels = Math.round(p.deletesPerPage);
  // Items are ids 1..; a higher id is newer and the feed is newest first. A Fenwick tree over ids
  // counts live items, so "the j-th item from the top" is an O(log n) lookup however deep the scroll.
  const initialCount = size * pages + 200;
  const maxId = initialCount + pages * ins + 1;
  const tree = new Int32Array(maxId + 1);
  const alive = new Uint8Array(maxId + 1);
  let live = 0;
  const add = (id: number, d: number) => {
    alive[id] = d > 0 ? 1 : 0;
    live += d;
    for (let i = id; i <= maxId; i += i & -i) tree[i] += d;
  };
  const prefix = (id: number) => {
    let s = 0;
    for (let i = id; i > 0; i -= i & -i) s += tree[i];
    return s;
  };
  const LOG = 1 << Math.floor(Math.log2(maxId));
  /** The smallest id whose prefix count reaches `target` (1-based rank from the oldest). */
  const select = (target: number) => {
    let pos = 0;
    for (let step = LOG; step > 0; step >>= 1)
      if (pos + step <= maxId && tree[pos + step] < target) {
        pos += step;
        target -= tree[pos];
      }
    return pos + 1;
  };
  /** The live item at position j from the top (0-based), or 0 past the end. */
  const fromTop = (j: number) => (j < live ? select(live - j) : 0);
  for (let id = 1; id <= initialCount; id++) add(id, 1);
  let nextId = initialCount + 1;

  const seenCount = new Uint16Array(maxId + 1);
  const seenList: number[] = [];
  const deleted = new Uint8Array(maxId + 1);
  const perPageMs: number[] = [];
  let cursor = Infinity;
  let oldestSeen = Infinity;
  let rowsScannedLast = 0;
  for (let k = 0; k < pages; k++) {
    // OFFSET skips k·size positions; a cursor starts right below the last id the user saw.
    const start = p.mode === "offset" ? k * size : cursor === Infinity ? 0 : live - prefix(cursor - 1);
    rowsScannedLast = p.mode === "offset" ? k * size + size : size;
    for (let j = start; j < start + size; j++) {
      const id = fromTop(j);
      if (!id) break;
      if (!seenCount[id]) seenList.push(id);
      seenCount[id]++;
      cursor = id;
      oldestSeen = Math.min(oldestSeen, id);
    }
    // Even with an index, OFFSET walks and discards every skipped row (~2 µs each); a keyset seek reads only the page.
    perPageMs.push(queryMs(rowsScannedLast, p.tableRows));
    // Between page requests, new posts arrive at the top and a few posts the user already scrolled past get deleted.
    for (let i = 0; i < ins; i++) add(nextId++, 1);
    for (let i = 0; i < dels && seenList.length; i++) {
      const victim = seenList[Math.floor(r() * seenList.length)];
      if (alive[victim]) {
        add(victim, -1);
        deleted[victim] = 1;
      }
    }
  }
  let duplicates = 0;
  for (const id of seenList) duplicates += seenCount[id] - 1;
  // Items that existed at the start, are still there, sit in the range the user scrolled past, but were never shown.
  let missed = 0;
  for (let id = Math.max(1, oldestSeen); id <= initialCount; id++) if (!seenCount[id] && !deleted[id]) missed++;
  return { seen: seenList.length, duplicates, missed, rowsScannedLast, lastPageMs: perPageMs[perPageMs.length - 1], perPageMs };
}

/** One page query: an index descent (deeper for bigger tables) plus ~2 µs per row walked. */
const queryMs = (rowsWalked: number, tableRows: number) => 0.5 + Math.log10(Math.max(10, tableRows)) * 0.1 + rowsWalked * 0.002;

export const pagination: SimDef<PageP, PageR> = {
  id: "pagination",
  title: "Offset vs cursor pagination on a live feed",
  module: 22,
  lessons: ["22.3", "2.3", "25.4"],
  blurb: "Page through a real newest-first feed while items are inserted and deleted between requests. Count duplicates, skipped items and the rows the database walks for each page.",
  params: [
    { key: "mode", label: "Pagination", type: "select", options: [{ value: "offset", label: "?offset=…&limit=…" }, { value: "cursor", label: "?after=<cursor>&limit=… (keyset)" }] },
    { key: "pageSize", label: "Page size", type: "number", min: 5, max: 100, step: 5 },
    { key: "pages", label: "Pages scrolled", type: "number", min: 1, max: 2000, log: true, hint: "Try a deep scroll or an export job that walks 2,000 pages." },
    { key: "insertsPerPage", label: "New items between page loads", type: "number", min: 0, max: 20 },
    { key: "deletesPerPage", label: "Already-seen items deleted between loads", type: "number", min: 0, max: 5, hint: "Someone deletes a post you scrolled past." },
    { key: "tableRows", label: "Rows in the table", type: "number", min: 1e4, max: 1e8, log: true },
  ],
  defaults: { mode: "offset", pageSize: 20, pages: 50, insertsPerPage: 3, deletesPerPage: 1, tableRows: 1e6 },
  run: runPagination,
  metrics: (r) => ({ duplicates: r.duplicates, missed: r.missed, rowsScanned: r.rowsScannedLast, lastPageMs: r.lastPageMs }),
  metricSpecs: [
    { key: "duplicates", label: "Items shown twice", format: fmt.n },
    { key: "missed", label: "Items skipped", format: fmt.n },
    { key: "rowsScanned", label: "Rows walked for the last page", format: fmt.n },
    { key: "lastPageMs", label: "Last page query time", format: (v) => (v < 10 ? `${v.toFixed(1)} ms` : fmt.ms(v)) },
  ],
  View: ({ p, r }) => (
    <>
      <LineChart yLabel="ms" xLabel="page number" xFormat={(i) => `${i + 1}`} series={[{ name: "Query time per page", color: "var(--accent)", values: r.perPageMs }]} />
      <Note>
        {p.mode === "offset"
          ? `OFFSET counts positions, and positions move: each new item at the top pushes everything down, so the next page starts with items you already saw. Each deletion above your offset pulls the next items up past it, so you never see them. The database also walks and discards every skipped row - ${fmt.n(r.rowsScannedLast)} for the last page.`
          : "The cursor remembers the last item you saw, not a position. New items at the top and deletions elsewhere can't shift it, and each page is an index seek that reads only the rows it returns."}
      </Note>
    </>
  ),
};

/* ------------------------------------------------------------------ idempotent retries */

type IdemP = { requestLossPct: number; responseLossPct: number; retries: number; key: "none" | "per-attempt" | "per-intent"; keyTtlHours: number; lateRetryPct: number; lateRetryHours: number; atomic: boolean };

interface IdemR {
  duplicates: number;
  lost: number;
  charged: number;
  unknown: number;
}

const PAYMENTS = 20000;
const CRASH_BETWEEN = 0.004; // the server dies between charging and saving the key

/** Each tap of "Pay" is one intent; the network can lose the request or the response, and clients retry. */
export function runIdempotency(p: IdemP): IdemR {
  const r = rng(5);
  let duplicates = 0;
  let lost = 0;
  let charged = 0;
  let unknown = 0;
  for (let i = 0; i < PAYMENTS; i++) {
    let charges = 0;
    let stored = false; // the server remembers this key and its response
    let storedAt = 0;
    let gotResponse = false;
    let clock = 0;
    for (let a = 0; a <= p.retries && !gotResponse; a++) {
      if (a > 0) clock += r() * 100 < p.lateRetryPct ? p.lateRetryHours : 0.0003 * 2 ** a; // a quick retry is seconds later; a late one waits for the app to reopen
      if (r() * 100 < p.requestLossPct) continue; // the server never saw it
      const sameKey = p.key === "per-intent" || (p.key === "per-attempt" && a === 0);
      const remembered = p.key !== "none" && stored && sameKey && clock - storedAt <= p.keyTtlHours;
      if (!remembered) {
        charges++;
        if (p.key !== "none" && (p.atomic || r() > CRASH_BETWEEN)) {
          stored = sameKey || a === 0;
          storedAt = clock;
        }
      }
      if (r() * 100 >= p.responseLossPct) gotResponse = true;
    }
    if (charges > 1) duplicates += charges - 1;
    if (charges > 0) charged++;
    if (charges === 0) lost++;
    if (!gotResponse) unknown++;
  }
  const per10k = (x: number) => (x / PAYMENTS) * 10000;
  return { duplicates: per10k(duplicates), lost: per10k(lost), charged: per10k(charged), unknown: per10k(unknown) };
}

export const idempotentRetries: SimDef<IdemP, IdemR> = {
  id: "idempotent-retries",
  title: "Retrying payments safely with idempotency keys",
  module: 22,
  lessons: ["22.4", "12.4", "25.11"],
  blurb: "20,000 taps of \"Pay\" over a flaky network. Requests and responses get lost and clients retry. Count double charges with no key, a new key per attempt, and one key per intent - and see what a short key TTL or a non-atomic save does.",
  params: [
    { key: "requestLossPct", label: "Requests lost before the server", type: "number", min: 0, max: 30, unit: "%" },
    { key: "responseLossPct", label: "Responses lost (server did the work)", type: "number", min: 0, max: 30, unit: "%", hint: "The dangerous case: the charge happened, but the client can't know." },
    { key: "retries", label: "Client retries", type: "number", min: 0, max: 6 },
    { key: "key", label: "Idempotency key", type: "select", options: [{ value: "none", label: "None" }, { value: "per-attempt", label: "New key on every attempt (bug)" }, { value: "per-intent", label: "One key per tap of Pay" }] },
    { key: "keyTtlHours", label: "Server keeps keys for", type: "number", min: 0.01, max: 720, log: true, unit: "h" },
    { key: "lateRetryPct", label: "Retries that happen after the app restarts", type: "number", min: 0, max: 50, unit: "%" },
    { key: "lateRetryHours", label: "…and how much later", type: "number", min: 0.1, max: 72, log: true, unit: "h" },
    { key: "atomic", label: "Save the key and the charge in one transaction", type: "toggle" },
  ],
  defaults: { requestLossPct: 3, responseLossPct: 5, retries: 3, key: "none", keyTtlHours: 24, lateRetryPct: 5, lateRetryHours: 2, atomic: false },
  run: runIdempotency,
  metrics: (r) => ({ duplicates: r.duplicates, lost: r.lost, unknown: r.unknown }),
  metricSpecs: [
    { key: "duplicates", label: "Double charges per 10k payments", format: (v) => v.toFixed(1) },
    { key: "lost", label: "Payments never made per 10k", format: (v) => v.toFixed(1) },
    { key: "unknown", label: "Clients left not knowing, per 10k", format: (v) => v.toFixed(1) },
  ],
  View: ({ r }) => (
    <>
      <Bars yLabel="per 10,000 payments" labels={["double charges", "never charged", "outcome unknown"]} values={[r.duplicates, r.lost, r.unknown]} color={(_, i) => (i === 0 ? "var(--bad)" : i === 1 ? "var(--warm)" : "var(--muted)")} yFormat={(v) => v.toFixed(0)} />
      <Note>
        Retries fix lost requests but turn lost responses into duplicates. An idempotency key lets the server recognise a retry and replay the first answer.
        It only works if the client reuses the key for every attempt of the same intent, the server keeps it longer than the latest retry, and the key is saved
        in the same transaction as the charge.
      </Note>
    </>
  ),
};

/* ------------------------------------------------------------------ token lifetime */

type TokenP = { users: number; reqPerUserMin: number; ttlMin: number; validation: "jwt" | "jwt-denylist" | "introspect"; authCapRps: number };

interface TokenR {
  authRps: number;
  authLoad: number;
  revokedWorksMin: number;
  revokedP99Min: number;
  lookupsRps: number;
  validateMs: number;
}

/** Access tokens: how long they live decides both the auth server's load and how long a revoked token keeps working. */
export function runTokens(p: TokenP): TokenR {
  const r = rng(3);
  const apiRps = (p.users * p.reqPerUserMin) / 60;
  const refreshRps = p.users / (p.ttlMin * 60);
  const introspectRps = p.validation === "introspect" ? apiRps * 0.2 : 0; // gateways cache introspection results for a few seconds
  const authRps = refreshRps + introspectRps;
  // Revoke 5,000 tokens at random moments in their life; how long do they keep working?
  const lags: number[] = [];
  for (let i = 0; i < 5000; i++) {
    const remaining = r() * p.ttlMin;
    lags.push(p.validation === "jwt" ? remaining : p.validation === "jwt-denylist" ? Math.min(remaining, 0.1) : Math.min(remaining, 5 / 60));
  }
  return {
    authRps,
    authLoad: authRps / p.authCapRps,
    revokedWorksMin: lags.reduce((a, b) => a + b, 0) / lags.length,
    revokedP99Min: percentile(lags, 0.99),
    lookupsRps: p.validation === "jwt" ? 0 : p.validation === "jwt-denylist" ? apiRps : introspectRps,
    validateMs: p.validation === "jwt" ? 0.05 : p.validation === "jwt-denylist" ? 0.4 : 0.2 * 4 + 0.8 * 0.4,
  };
}

export const tokenLifetime: SimDef<TokenP, TokenR> = {
  id: "token-lifetime",
  title: "Access token lifetime: revocation vs auth load",
  module: 21,
  lessons: ["21.5", "21.6"],
  blurb: "Short-lived tokens limit the damage of a stolen or revoked token but make every client refresh more often. Self-contained JWTs skip the auth server; introspection and denylists don't.",
  params: [
    { key: "users", label: "Active users", type: "number", min: 1000, max: 10_000_000, log: true },
    { key: "reqPerUserMin", label: "API calls per user per minute", type: "number", min: 1, max: 60 },
    { key: "ttlMin", label: "Access token lifetime", type: "number", min: 1, max: 1440, log: true, unit: "min" },
    { key: "validation", label: "How the API checks a token", type: "select", options: [{ value: "jwt", label: "Verify the JWT signature only" }, { value: "jwt-denylist", label: "JWT + denylist lookup (Redis)" }, { value: "introspect", label: "Opaque token, ask the auth server (cached 5 s)" }] },
    { key: "authCapRps", label: "Auth server capacity", type: "number", min: 500, max: 100000, log: true, unit: "req/s" },
  ],
  defaults: { users: 2_000_000, reqPerUserMin: 6, ttlMin: 1440, validation: "jwt", authCapRps: 5000 },
  run: runTokens,
  metrics: (r) => ({ revokedP99Min: r.revokedP99Min, authLoad: r.authLoad, lookupsRps: r.lookupsRps }),
  metricSpecs: [
    { key: "revokedP99Min", label: "A revoked token still works for (p99)", format: (v) => (v < 1 ? `${Math.round(v * 60)} s` : v < 120 ? `${Math.round(v)} min` : `${(v / 60).toFixed(1)} h`) },
    { key: "authLoad", label: "Auth server load", format: fmt.pct },
    { key: "lookupsRps", label: "Extra lookups per second", format: fmt.n },
  ],
  View: ({ r }) => (
    <>
      <Stats
        items={[
          { label: "Token refreshes + checks /s", value: fmt.n(r.authRps), tone: r.authLoad > 0.8 ? "bad" : "good" },
          { label: "Avg time a revoked token works", value: r.revokedWorksMin < 1 ? `${Math.round(r.revokedWorksMin * 60)} s` : `${Math.round(r.revokedWorksMin)} min` },
          { label: "Added check per request", value: `${r.validateMs.toFixed(2)} ms` },
        ]}
      />
      <Note>
        A JWT is checked with a public key and no network call, which is why it scales - and why logging out, firing an employee or rotating a leaked token
        doesn't stop it until it expires. Keep access tokens short (5-15 minutes) and let refresh tokens, which the auth server does check, carry the long session.
      </Note>
    </>
  ),
};

/* ------------------------------------------------------------------ debounce */

type DebounceP = { strategy: "every-key" | "debounce" | "throttle"; waitMs: number; minChars: number; serverP50: number; serverP99: number; cancelStale: boolean; clientCache: boolean };

interface DebounceR {
  reqPerSearch: number;
  finalDelayMs: number;
  staleShownPct: number;
  reqTimeline: number[];
}

const SEARCHES = 600;

function typingSession(r: Rand): number[] {
  const len = 5 + Math.floor(r() * 10);
  const times: number[] = [];
  let t = 0;
  for (let i = 0; i < len; i++) {
    t += lognormal(r, 140, 700) + (r() < 0.08 ? 600 + r() * 900 : 0); // occasional pause to think
    times.push(t);
  }
  return times;
}

/** Search-as-you-type: real keystroke timings, the chosen request strategy, random server latency and out-of-order replies. */
export function runDebounce(p: DebounceP): DebounceR {
  const r = rng(21);
  let requests = 0;
  let delaySum = 0;
  let staleShown = 0;
  const hist = new Array(20).fill(0);
  for (let s = 0; s < SEARCHES; s++) {
    const keys = typingSession(r);
    const last = keys[keys.length - 1];
    const sends: { at: number; prefix: number }[] = [];
    if (p.strategy === "every-key") keys.forEach((t, i) => sends.push({ at: t, prefix: i + 1 }));
    else if (p.strategy === "debounce") {
      keys.forEach((t, i) => {
        const next = keys[i + 1];
        if (next === undefined || next - t > p.waitMs) sends.push({ at: t + p.waitMs, prefix: i + 1 });
      });
    } else {
      let nextAllowed = 0;
      keys.forEach((t, i) => {
        if (t >= nextAllowed) {
          sends.push({ at: t, prefix: i + 1 });
          nextAllowed = t + p.waitMs;
        }
      });
      if (sends[sends.length - 1]?.prefix !== keys.length) sends.push({ at: Math.max(last, nextAllowed), prefix: keys.length });
    }
    const seen = new Set<number>();
    const replies = sends
      .filter((x) => x.prefix >= p.minChars)
      .filter((x) => {
        if (!p.clientCache) return true;
        if (seen.has(x.prefix)) return false;
        seen.add(x.prefix);
        return true;
      })
      .map((x) => ({ ...x, back: x.at + lognormal(r, p.serverP50, p.serverP99) }));
    requests += replies.length;
    replies.forEach((x) => (hist[Math.min(19, Math.floor(x.at / 500))] += 1));
    // What does the user see? Results are drawn as replies arrive. Without cancellation, a slow reply for an old prefix can land after the newest one.
    let shownPrefix = 0;
    let finalAt = Infinity;
    let stale = false;
    for (const x of [...replies].sort((a, b) => a.back - b.back)) {
      if (p.cancelStale && x.prefix < shownPrefix) continue;
      if (x.prefix < shownPrefix) stale = true;
      shownPrefix = x.prefix;
      if (x.prefix === keys.length) finalAt = x.back;
    }
    if (shownPrefix !== keys.length && Number.isFinite(finalAt)) stale = true;
    if (stale) staleShown++;
    delaySum += (Number.isFinite(finalAt) ? finalAt : last + p.serverP99) - last;
  }
  return { reqPerSearch: requests / SEARCHES, finalDelayMs: delaySum / SEARCHES, staleShownPct: staleShown / SEARCHES, reqTimeline: hist.map((h) => h / SEARCHES) };
}

export const debounceSim: SimDef<DebounceP, DebounceR> = {
  id: "debounce",
  title: "Search-as-you-type: debounce, throttle and stale replies",
  module: 23,
  lessons: ["23.2", "25.2"],
  blurb: "600 people type real-looking queries. Send a request on every key, debounce or throttle, and watch request volume, how long the final results take, and how often an old reply overwrites a newer one.",
  params: [
    { key: "strategy", label: "When to send", type: "select", options: [{ value: "every-key", label: "On every keystroke" }, { value: "debounce", label: "Debounce: after a pause" }, { value: "throttle", label: "Throttle: at most once per wait" }] },
    { key: "waitMs", label: "Wait", type: "number", min: 50, max: 1000, step: 25, unit: "ms" },
    { key: "minChars", label: "Minimum characters before searching", type: "number", min: 1, max: 4 },
    { key: "serverP50", label: "Search API p50", type: "number", min: 10, max: 400, step: 10, unit: "ms" },
    { key: "serverP99", label: "Search API p99", type: "number", min: 50, max: 2000, step: 50, unit: "ms" },
    { key: "cancelStale", label: "Cancel or ignore out-of-date replies", type: "toggle" },
    { key: "clientCache", label: "Remember prefixes already fetched", type: "toggle" },
  ],
  defaults: { strategy: "every-key", waitMs: 250, minChars: 1, serverP50: 80, serverP99: 600, cancelStale: false, clientCache: false },
  run: runDebounce,
  metrics: (r) => ({ reqPerSearch: r.reqPerSearch, finalDelayMs: r.finalDelayMs, stale: r.staleShownPct }),
  metricSpecs: [
    { key: "reqPerSearch", label: "Requests per search", format: (v) => v.toFixed(1) },
    { key: "finalDelayMs", label: "Last key → final results", format: fmt.ms },
    { key: "stale", label: "Searches that flashed stale results", format: fmt.pct },
  ],
  View: ({ r }) => (
    <>
      <Bars yLabel="requests per search" xLabel="time since first keystroke (0.5 s buckets)" labels={r.reqTimeline.map((_, i) => `${(i / 2).toFixed(1)}`)} values={r.reqTimeline} yFormat={(v) => v.toFixed(1)} />
      <Note>
        Debouncing waits for a pause, so it sends few requests but adds the wait to every search. Throttling keeps results flowing while you type. Either way,
        replies can arrive out of order: tag each request (or abort the previous one) and draw only the newest.
      </Note>
    </>
  ),
};

/* ------------------------------------------------------------------ latency budget */

type LatP = { distanceKm: number; lastMileMs: number; dns: boolean; connection: "new" | "reused"; protocol: "h1-tls12" | "h2-tls13" | "h3" | "h3-0rtt"; edge: boolean; payloadKB: number; linkMbps: number; dbQueries: number; dbMs: number; cpuMs: number };

interface LatR {
  totalMs: number;
  rttMs: number;
  phases: { name: string; ms: number }[];
  handshakeRtts: number;
  slowStartRtts: number;
}

const FIBER_KM_PER_MS = 200; // light in glass: ~2/3 of c
const ROUTE_FACTOR = 1.6; // real paths aren't straight lines
const INIT_CWND_BYTES = 10 * 1460; // RFC 6928 initial window

const HANDSHAKE: Record<LatP["protocol"], number> = { "h1-tls12": 3, "h2-tls13": 2, h3: 1, "h3-0rtt": 0 };

/** Back-of-the-envelope response time for one API call, phase by phase. */
export function runLatency(p: LatP): LatR {
  const rtt = (2 * p.distanceKm * ROUTE_FACTOR) / FIBER_KM_PER_MS + p.lastMileMs;
  // With an edge (CDN / edge proxy), the client's handshakes go to a nearby PoP; the PoP keeps warm connections to the origin.
  const nearRtt = p.edge ? Math.min(rtt, 10 + p.lastMileMs) : rtt;
  const dnsMs = p.dns ? nearRtt * 0.5 + 20 : 0;
  const handshakeRtts = p.connection === "reused" ? 0 : HANDSHAKE[p.protocol];
  const handshakeMs = handshakeRtts * nearRtt;
  const requestMs = p.edge ? nearRtt + rtt * 0.85 : rtt; // edge→origin runs on a tuned backbone
  // TCP/QUIC slow start: a new connection sends 14.6 KB, then doubles each round trip.
  const bytes = p.payloadKB * 1024;
  let slowStartRtts = 0;
  if (p.connection === "new") {
    let sent = INIT_CWND_BYTES;
    let cwnd = INIT_CWND_BYTES;
    while (sent < bytes) {
      cwnd *= 2;
      sent += cwnd;
      slowStartRtts++;
    }
  }
  const transferMs = slowStartRtts * nearRtt + ((bytes * 8) / (p.linkMbps * 1e6)) * 1000;
  const serverMs = p.cpuMs + p.dbQueries * p.dbMs;
  const phases = [
    { name: "DNS", ms: dnsMs },
    { name: "handshakes", ms: handshakeMs },
    { name: "request + reply", ms: requestMs },
    { name: "server work", ms: serverMs },
    { name: "download", ms: transferMs },
  ];
  return { totalMs: phases.reduce((s, x) => s + x.ms, 0), rttMs: rtt, phases, handshakeRtts, slowStartRtts };
}

export const latencyBudget: SimDef<LatP, LatR> = {
  id: "latency-budget",
  title: "Where an API call's milliseconds go",
  module: 24,
  lessons: ["24.3", "24.4", "24.2", "19.4"],
  blurb: "Distance, handshakes, slow start, bandwidth and server work, added up the way you would on a whiteboard. Move the user, change the protocol, reuse connections or add an edge and watch the budget.",
  params: [
    { key: "distanceKm", label: "User to data centre", type: "number", min: 10, max: 15000, log: true, unit: "km", hint: "Mumbai → Frankfurt is ~6,300 km; New York → Sydney ~16,000 km." },
    { key: "lastMileMs", label: "Last-mile delay (Wi-Fi / mobile)", type: "number", min: 1, max: 100, unit: "ms" },
    { key: "dns", label: "DNS lookup needed (not cached)", type: "toggle" },
    { key: "connection", label: "Connection", type: "select", options: [{ value: "new", label: "New connection" }, { value: "reused", label: "Reused (keep-alive)" }] },
    { key: "protocol", label: "Protocol", type: "select", options: [{ value: "h1-tls12", label: "HTTP/1.1 + TLS 1.2 (3 RTT)" }, { value: "h2-tls13", label: "HTTP/2 + TLS 1.3 (2 RTT)" }, { value: "h3", label: "HTTP/3 over QUIC (1 RTT)" }, { value: "h3-0rtt", label: "HTTP/3 resumed, 0-RTT" }] },
    { key: "edge", label: "Terminate at a nearby edge", type: "toggle" },
    { key: "payloadKB", label: "Response size", type: "number", min: 1, max: 2000, log: true, unit: "KB" },
    { key: "linkMbps", label: "Client bandwidth", type: "number", min: 1, max: 500, log: true, unit: "Mbps" },
    { key: "dbQueries", label: "Sequential DB queries", type: "number", min: 0, max: 20 },
    { key: "dbMs", label: "Per query", type: "number", min: 0.5, max: 20, step: 0.5, unit: "ms" },
    { key: "cpuMs", label: "Server CPU work", type: "number", min: 1, max: 200, unit: "ms" },
  ],
  defaults: { distanceKm: 6300, lastMileMs: 20, dns: true, connection: "new", protocol: "h1-tls12", edge: false, payloadKB: 120, linkMbps: 20, dbQueries: 6, dbMs: 3, cpuMs: 15 },
  run: runLatency,
  metrics: (r) => ({ totalMs: r.totalMs, rttMs: r.rttMs, handshakeRtts: r.handshakeRtts }),
  metricSpecs: [
    { key: "totalMs", label: "Response time", format: fmt.ms },
    { key: "rttMs", label: "Round-trip time", format: fmt.ms },
    { key: "handshakeRtts", label: "Handshake round trips", format: fmt.n },
  ],
  View: ({ r }) => (
    <>
      <Bars yLabel="ms" labels={r.phases.map((x) => x.name)} values={r.phases.map((x) => x.ms)} refLine={200} refLabel="200 ms budget" />
      <Note>
        Round trip ≈ 2 × distance × 1.6 ÷ 200 km/ms + last mile = {fmt.ms(r.rttMs)}. A new connection pays {r.handshakeRtts} handshake round trip
        {r.handshakeRtts === 1 ? "" : "s"}
        {r.slowStartRtts ? ` and ${r.slowStartRtts} more while slow start grows the window` : ""}. Far-away users are dominated by round trips, so the biggest
        wins are fewer of them: reuse connections, use TLS 1.3 / HTTP/3, and terminate close to the user.
      </Note>
    </>
  ),
};

/* ------------------------------------------------------------------ chunked uploads */

type UploadP = { fileMB: number; linkMbps: number; dropsPerHour: number; mode: "single" | "resumable"; chunkMB: number; parallel: number; rttMs: number; maxAttempts: number };

interface UploadR {
  success: number;
  avgMin: number;
  p95Min: number;
  overhead: number;
}

const UPLOADS = 400;

/** Uploads over a connection that drops at random (a Poisson process). Single requests restart from zero; resumable ones lose one chunk. */
export function runUpload(p: UploadP): UploadR {
  const r = rng(13);
  const bytesPerSec = (p.linkMbps * 1e6) / 8;
  const fileBytes = p.fileMB * 1e6;
  const dropRate = p.dropsPerHour / 3600; // per second of transfer
  const times: number[] = [];
  let ok = 0;
  let sentTotal = 0;
  for (let u = 0; u < UPLOADS; u++) {
    let t = 0;
    let sent = 0;
    let done = false;
    let attempts = 0;
    const nextDrop = () => (dropRate > 0 ? -Math.log(1 - r()) / dropRate : Infinity);
    if (p.mode === "single") {
      while (attempts < p.maxAttempts && !done) {
        attempts++;
        const need = fileBytes / bytesPerSec + p.rttMs / 1000;
        const drop = nextDrop();
        if (drop >= need) {
          t += need;
          sent += fileBytes;
          done = true;
        } else {
          t += drop + 2;
          sent += drop * bytesPerSec;
        }
      }
    } else {
      const chunk = Math.min(fileBytes, p.chunkMB * 1e6);
      const lanes = Math.max(1, Math.round(p.parallel));
      // Parallel chunks share the link; each chunk costs one request round trip.
      const perChunkSec = (chunk / bytesPerSec) * lanes + p.rttMs / 1000;
      let remaining = Math.ceil(fileBytes / chunk);
      let failures = 0; // in a row: progress resets it
      while (remaining > 0 && failures < p.maxAttempts) {
        const wave = Math.min(lanes, remaining);
        const drop = nextDrop();
        if (drop >= perChunkSec) {
          t += perChunkSec;
          sent += wave * chunk;
          remaining -= wave;
          failures = 0;
        } else {
          t += drop + 2 + p.rttMs / 1000; // reconnect, then ask the server which bytes it has
          sent += (drop / perChunkSec) * wave * chunk;
          failures++;
        }
      }
      done = remaining === 0;
    }
    sentTotal += sent;
    if (done) {
      ok++;
      times.push(t / 60);
    }
  }
  return { success: ok / UPLOADS, avgMin: times.length ? times.reduce((a, b) => a + b, 0) / times.length : Infinity, p95Min: times.length ? percentile(times, 0.95) : Infinity, overhead: sentTotal / (UPLOADS * fileBytes) };
}

export const chunkedUpload: SimDef<UploadP, UploadR> = {
  id: "chunked-upload",
  title: "Big uploads on flaky networks",
  module: 25,
  lessons: ["25.3", "25.6"],
  blurb: "400 people upload a large video over a connection that drops now and then. A single request restarts from zero; resumable, chunked uploads lose one chunk. Tune chunk size and parallelism.",
  params: [
    { key: "fileMB", label: "File size", type: "number", min: 1, max: 5000, log: true, unit: "MB" },
    { key: "linkMbps", label: "Upload bandwidth", type: "number", min: 1, max: 200, log: true, unit: "Mbps" },
    { key: "dropsPerHour", label: "Connection drops per hour", type: "number", min: 0, max: 60 },
    { key: "mode", label: "Upload", type: "select", options: [{ value: "single", label: "One PUT request" }, { value: "resumable", label: "Resumable, in chunks" }] },
    { key: "chunkMB", label: "Chunk size", type: "number", min: 1, max: 256, log: true, unit: "MB" },
    { key: "parallel", label: "Chunks in parallel", type: "number", min: 1, max: 8 },
    { key: "rttMs", label: "Round trip per request", type: "number", min: 10, max: 400, step: 10, unit: "ms" },
    { key: "maxAttempts", label: "Client gives up after", type: "number", min: 1, max: 10, unit: "failures in a row" },
  ],
  defaults: { fileMB: 2000, linkMbps: 10, dropsPerHour: 6, mode: "single", chunkMB: 8, parallel: 1, rttMs: 120, maxAttempts: 5 },
  run: runUpload,
  metrics: (r) => ({ success: r.success, avgMin: r.avgMin, overhead: r.overhead }),
  metricSpecs: [
    { key: "success", label: "Uploads that finish", format: fmt.pct },
    { key: "avgMin", label: "Average time", format: (v) => (Number.isFinite(v) ? `${v.toFixed(1)} min` : "-") },
    { key: "overhead", label: "Bytes sent ÷ file size", format: fmt.x },
  ],
  View: ({ p, r }) => (
    <>
      <Stats
        items={[
          { label: "Finished", value: fmt.pct(r.success), tone: r.success >= 0.99 ? "good" : "bad" },
          { label: "p95 time", value: Number.isFinite(r.p95Min) ? `${r.p95Min.toFixed(1)} min` : "-" },
          { label: "Wasted upload", value: fmt.pct(Math.max(0, r.overhead - 1)) },
        ]}
      />
      <Note>
        {p.mode === "single"
          ? `At ${p.linkMbps} Mbps a ${p.fileMB} MB file takes ${((p.fileMB * 8) / p.linkMbps / 60).toFixed(1)} minutes. With ${p.dropsPerHour} drops an hour, a long single request is likely to be cut, and every retry starts from byte zero.`
          : "Each chunk is its own request, so a drop costs one chunk, and the client asks the server which bytes arrived before resuming. Tiny chunks waste round trips; huge chunks lose more per drop."}
      </Note>
    </>
  ),
};

export const API_SIMS = [payloadFormats, fetchPatterns, tokenLifetime, pagination, idempotentRetries, debounceSim, latencyBudget, chunkedUpload];
