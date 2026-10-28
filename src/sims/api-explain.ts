/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SimExplain } from "./explain";
import { fmt } from "./types";

type Fn = (p: any, m: Record<string, number>) => SimExplain;

const pct = fmt.pct;
const kb = (bytes: number) => fmt.kb(bytes / 1024);
const FORMAT: Record<string, string> = { json: "JSON", "json-short": "JSON with short keys", msgpack: "MessagePack", protobuf: "Protobuf" };
const FETCH: Record<string, string> = { rest: "one REST call per resource", "rest-expand": "REST with ?include=", graphql: "one GraphQL query", bff: "a backend-for-frontend endpoint" };
const VALIDATION: Record<string, string> = { jwt: "verifies the JWT signature only", "jwt-denylist": "verifies the JWT and checks a denylist", introspect: "asks the auth server about an opaque token (cached 5 s)" };
const PROTOCOL: Record<string, string> = { "h1-tls12": "HTTP/1.1 + TLS 1.2", "h2-tls13": "HTTP/2 + TLS 1.3", h3: "HTTP/3", "h3-0rtt": "HTTP/3 with 0-RTT resumption" };

/** Plain-language guides for Part 3 (API design) simulations. */
export const API_EXPLAIN: Record<string, Fn> = {
  "payload-formats": (p, m) => ({
    scenario: `Each response carries ${Math.round(p.records)} ${p.shape === "users" ? "user profiles" : p.shape === "metrics" ? "sensor readings" : "articles"} as ${FORMAT[p.format]}, ${fmt.n(p.rps)} times a second, to clients on ${p.linkMbps} Mbps links.`,
    outcome: `A response is ${kb(m.bytes)}: ${fmt.ms(m.transferMs)} to download on that link, ${m.mbPerSec.toFixed(1)} MB/s of egress and about $${fmt.n(m.usdPerMonth)} a month.`,
    good: m.transferMs <= 200 && m.usdPerMonth <= 5000,
    fix: p.format === "json" ? "Try a binary format (Protobuf or MessagePack), turn on compression, or return fewer records per page." : "Return fewer records or fewer fields per response; size matters more than the format once the format is compact.",
    tradeoff: "Binary formats are smaller and faster to parse but unreadable without tooling and need a shared schema; JSON is universal and easy to debug.",
  }),
  "fetch-patterns": (p, m) => ({
    scenario: `A profile screen with ${p.posts} posts is loaded with ${FETCH[p.style]}${p.style === "graphql" ? (p.dataloader ? " (resolvers batched with DataLoader)" : " (no resolver batching)") : ""}, over a ${p.rttMs} ms round trip.`,
    outcome: `It takes ${fmt.ms(m.loadMs)}: ${fmt.n(m.rounds)} round trip${m.rounds === 1 ? "" : "s"} in a row, ${fmt.kb(m.kb)} downloaded and ${fmt.n(m.queries)} database queries.`,
    good: m.loadMs <= 600 && m.queries <= 10,
    fix: p.style === "rest" ? "Cut sequential round trips: fetch the screen in one call with ?include=, a GraphQL query or a BFF endpoint." : p.style === "graphql" && !p.dataloader ? "Batch the per-post resolvers with DataLoader so N posts cost one query, not N." : "Trim the fields you return; on slow links, bytes are what's left.",
    tradeoff: "One big call is fast but couples the API to a screen; GraphQL adds a query layer to secure and cost-limit; a BFF is one more service per client type.",
  }),
  "token-lifetime": (p, m) => ({
    scenario: `${fmt.n(p.users)} active users call the API ${p.reqPerUserMin}× a minute with access tokens that live ${p.ttlMin} minutes; the API ${VALIDATION[p.validation]}.`,
    outcome: `A revoked token keeps working for up to ${m.revokedP99Min < 1 ? `${Math.round(m.revokedP99Min * 60)} s` : `${Math.round(m.revokedP99Min)} min`} (p99). The auth server is ${pct(m.authLoad)} busy${m.lookupsRps ? `, and requests make ${fmt.n(m.lookupsRps)} extra lookups/s` : ""}.`,
    good: m.revokedP99Min <= 15 && m.authLoad <= 0.8,
    fix: m.revokedP99Min > 15 ? "Shorten access tokens to 5-15 minutes and keep sessions alive with refresh tokens, or add a denylist check for high-risk APIs." : "The auth server can't keep up: lengthen tokens a little, cache introspection results, or scale the auth server.",
    tradeoff: "Short tokens mean more refresh traffic; denylists and introspection add a lookup to every request and a dependency that can fail.",
  }),
  pagination: (p, m) => ({
    scenario: `A user scrolls ${Math.round(p.pages)} pages of ${Math.round(p.pageSize)} items with ${p.mode === "offset" ? "offset" : "cursor (keyset)"} pagination while ${p.insertsPerPage} new items arrive and ${p.deletesPerPage} seen ones are deleted between page loads.`,
    outcome: `${fmt.n(m.duplicates)} items were shown twice and ${fmt.n(m.missed)} were skipped. The last page walked ${fmt.n(m.rowsScanned)} rows and took ${m.lastPageMs < 10 ? `${m.lastPageMs.toFixed(1)} ms` : fmt.ms(m.lastPageMs)}.`,
    good: m.duplicates === 0 && m.missed === 0 && m.lastPageMs <= 10,
    fix: p.mode === "offset" ? "Switch to a cursor: return the last item's sort key (e.g. created_at + id) as an opaque token and query WHERE (created_at, id) < cursor." : "Cursors are stable here; keep an index on the sort key so every page is a seek.",
    tradeoff: "Cursors can't jump to page 37 or show a total page count; offsets can, at the price of drift and slow deep pages.",
  }),
  "idempotent-retries": (p, m) => ({
    scenario: `Payments over a network that loses ${p.requestLossPct}% of requests and ${p.responseLossPct}% of responses; clients retry up to ${p.retries}× with ${p.key === "none" ? "no idempotency key" : p.key === "per-attempt" ? "a new key on each attempt" : "one key per payment"}${p.key !== "none" ? `, kept for ${p.keyTtlHours} h${p.atomic ? " and saved with the charge" : " and saved separately from the charge"}` : ""}.`,
    outcome: `${m.duplicates.toFixed(1)} double charges and ${m.lost.toFixed(1)} payments never made per 10,000; ${m.unknown.toFixed(1)} clients gave up not knowing the outcome.`,
    good: m.duplicates < 0.5 && m.lost <= 5,
    fix:
      p.key === "none" ? "Send an Idempotency-Key header generated once per tap of Pay, and store it with the result." :
      p.key === "per-attempt" ? "Generate the key once per intent and reuse it on every retry - a new key makes each retry look like a new payment." :
      !p.atomic ? "Save the key and the charge in one transaction, so a crash can't leave a charge without its key." :
      m.duplicates >= 0.5 ? "Keep keys longer than the latest retry can arrive (24 h or more)." : "Allow a retry or two more, so fewer payments silently fail.",
    tradeoff: "Keys cost storage and a lookup per write, and the server must reject a reused key with a different body; retries add load during outages.",
  }),
  debounce: (p, m) => ({
    scenario: `Search-as-you-type sends ${p.strategy === "every-key" ? "a request on every keystroke" : p.strategy === "debounce" ? `after a ${p.waitMs} ms pause` : `at most once every ${p.waitMs} ms`}, from ${p.minChars} character${p.minChars > 1 ? "s" : ""}; the API answers in ${p.serverP50} ms (p50) to ${p.serverP99} ms (p99).`,
    outcome: `${m.reqPerSearch.toFixed(1)} requests per search; final results show ${fmt.ms(m.finalDelayMs)} after the last key; ${pct(m.stale)} of searches flashed out-of-date results.`,
    good: m.reqPerSearch <= 5 && m.finalDelayMs <= 450 && m.stale <= 0.01,
    fix: p.strategy === "every-key" ? "Debounce (~150-300 ms) or throttle requests, and start after 2-3 characters." : m.stale > 0.01 ? "Ignore replies older than the newest request (or abort them with AbortController)." : "Shorten the wait or cache prefix results so users don't feel it.",
    tradeoff: "Longer waits mean fewer requests but slower-feeling search; caching prefixes uses memory and can show slightly stale suggestions.",
  }),
  "latency-budget": (p, m) => ({
    scenario: `A user ${fmt.n(p.distanceKm)} km away makes ${p.connection === "new" ? "a first call on a new" : "a call on a reused"} ${PROTOCOL[p.protocol]} connection${p.edge ? " through a nearby edge" : ""}; the server runs ${p.dbQueries} queries and returns ${p.payloadKB} KB.`,
    outcome: `It takes about ${fmt.ms(m.totalMs)}. One round trip is ${fmt.ms(m.rttMs)}, and the connection setup costs ${m.handshakeRtts} of them.`,
    good: m.totalMs <= 200,
    fix: p.connection === "new" ? "Reuse connections, move to TLS 1.3 or HTTP/3, and terminate TLS at an edge close to the user." : "Do less on the server (fewer sequential queries), shrink the response, or serve from a region closer to the user.",
    tradeoff: "Edges and extra regions cost money and add consistency questions; 0-RTT data can be replayed, so only use it for safe requests.",
  }),
  "chunked-upload": (p, m) => ({
    scenario: `${p.fileMB} MB files over ${p.linkMbps} Mbps with ${p.dropsPerHour} connection drops an hour, sent ${p.mode === "single" ? "as one request" : `in ${p.chunkMB} MB chunks, ${p.parallel} at a time`}.`,
    outcome: `${pct(m.success)} of uploads finish${Number.isFinite(m.avgMin) ? `, in ${m.avgMin.toFixed(1)} min on average` : ""}; ${fmt.x(m.overhead)} the file size is sent.`,
    good: m.success >= 0.99 && m.overhead <= 1.1,
    fix: p.mode === "single" ? "Make uploads resumable: upload in chunks and let the client ask the server which bytes it already has." : m.overhead > 1.1 ? "Use smaller chunks so a drop wastes less." : "Use bigger chunks or a little parallelism to cut per-request overhead.",
    tradeoff: "Resumable uploads need server-side upload sessions, expiry and assembly; tiny chunks pay a round trip each.",
  }),
};
