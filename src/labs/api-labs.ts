import { build } from "../presets";
import type { Lab } from "./types";

const ok = { type: "successRate", min: 0.99 } as const;

/* ------------------------------------------------------------------ module 19 */

export const apiContract: Lab = {
  slug: "api-library-loans",
  module: 19,
  title: "Design a library loans API",
  product: "City library app",
  summary: "Turn a librarian's wish list into resources, methods and status codes, pick the right errors, and choose a payload format for a slow network.",
  difficulty: "easy",
  minutes: 25,
  tags: ["HTTP", "resources", "status codes", "data formats"],
  steps: [
    {
      type: "intro",
      title: "The brief",
      body: `A city library wants an API that its mobile app, its website and two partner schools can use.

**What members do**
- Browse the catalogue and open one book's details.
- Borrow a copy, see their loans, and return a book.

**What the librarian worries about**
- A book that's already on loan must not be lent twice.
- Partner schools sync the whole catalogue every night: **200 records per page, 2,000 pages a second** at peak, often over slow school networks.

Design the contract first. Everything else (servers, databases) can change later; the contract is what clients build against.`,
    },
    {
      type: "quiz",
      title: "Safe and idempotent",
      body: "Clients and proxies retry requests when a network blips. Which methods are safe to repeat depends on their meaning in HTTP, not on your code.",
      question: "A member updates their notification settings by sending the whole settings object. The request times out. Which method makes a blind retry safe?",
      options: [
        { text: "POST /members/me/settings", why: "POST isn't idempotent: by definition each POST may create or do something new, so clients and proxies won't retry it automatically." },
        { text: "PUT /members/me/settings", correct: true, why: "Right. PUT replaces the resource with the body you send. Sending the same body twice leaves the same state, so it's idempotent and safe to retry." },
        { text: "PATCH /members/me/settings with {\"emailsPerWeek\": \"+1\"}", why: "A relative PATCH like \"add one\" changes the result every time it runs. PATCH is only idempotent when the patch itself is (like setting a value)." },
      ],
    },
    {
      type: "api",
      title: "Design the endpoints",
      body: "Add one endpoint per requirement. Use nouns for resources and let the method say what happens. Model a loan as its own resource: it has a borrower, a copy, a due date and a state.",
      baseUrl: "https://api.library.example/v1",
      expect: [
        { goal: "List books in the catalogue", methods: ["GET"], statuses: [200], pathMatch: "books", why: "Reading a collection is a GET on the collection (/books), answered with 200 and a page of results." },
        { goal: "Get one book's details", methods: ["GET"], statuses: [200], needsParam: true, pathMatch: "books", why: "One item is a GET on /books/:id." },
        { goal: "Borrow a copy (create a loan)", methods: ["POST"], statuses: [201], pathMatch: "loans", why: "Borrowing creates a new loan: POST /loans with the book id, answered with 201 Created and a Location header pointing at /loans/:id." },
        { goal: "Return a book (end a loan)", methods: ["POST", "PATCH", "DELETE"], statuses: [200, 204], needsParam: true, pathMatch: "loans", why: "Returning changes the loan's state: PATCH /loans/:id {\"status\":\"returned\"}, or an explicit action like POST /loans/:id/return. DELETE works too, but you lose the loan history." },
      ],
      solution: [
        { method: "GET", path: "/books", status: 200 },
        { method: "GET", path: "/books/:id", status: 200 },
        { method: "POST", path: "/loans", status: 201 },
        { method: "POST", path: "/loans/:id/return", status: 200 },
      ],
    },
    {
      type: "quiz",
      title: "The book is already out",
      body: "A member taps Borrow on a book whose only copy was lent five seconds ago. The request itself is well formed and the member is signed in.",
      question: "What should POST /loans return?",
      options: [
        { text: "400 Bad Request", why: "400 means the request is malformed: bad JSON, a missing field. This request is fine; it conflicts with the current state." },
        { text: "404 Not Found", why: "The book exists. 404 would send the app down the wrong path (\"this book was removed\")." },
        { text: "409 Conflict, with a problem+json body explaining that no copy is available", correct: true, why: "Right. 409 says the request conflicts with the resource's current state. A machine-readable body (RFC 9457 problem details: type, title, detail) lets the app show \"join the waitlist\" instead of a generic error." },
        { text: "200 OK with {\"success\": false}", why: "Every client, proxy and monitor treats 200 as success. Error rates vanish from your dashboards and retries can't tell what happened." },
      ],
    },
    {
      type: "quiz",
      title: "401 or 403?",
      body: "A signed-in member calls GET /loans?member=4521 to see someone else's loans.",
      question: "Which status code is right?",
      options: [
        { text: "401 Unauthorized", why: "401 means \"I don't know who you are\": the credentials are missing or invalid, and the client should sign in again. This member is signed in." },
        { text: "403 Forbidden (or 404 if you'd rather not confirm the member exists)", correct: true, why: "Right. The server knows who the caller is and refuses this action. Some APIs answer 404 for other people's objects so attackers can't probe which ids exist." },
        { text: "200 with an empty list", why: "That hides an access-control decision behind a fake answer; the app can't tell \"no loans\" from \"not allowed\"." },
      ],
    },
    {
      type: "sim",
      title: "Measure it: the nightly catalogue sync",
      body: "Partner schools pull 200 catalogue records per page over a 2 Mbps link, and your egress bill is growing. The records are mostly ids, counts and timestamps. Pick a format (or a page size) that gets each page across in under 40 ms and keeps egress under $4,000 a month.",
      sim: "payload-formats",
      params: { shape: "metrics", records: 200, format: "json", rps: 2000, linkMbps: 2, egressUsdPerGB: 0.08 },
      locked: ["shape", "rps", "linkMbps", "egressUsdPerGB"],
      goals: [
        { metric: "transferMs", op: "<=", value: 40, label: "A page downloads in ≤ 40 ms on 2 Mbps" },
        { metric: "usdPerMonth", op: "<=", value: 4000, label: "Egress ≤ $4,000/month" },
      ],
      hints: ["Compare the bars: which formats repeat the field names in every record?", "Short JSON keys help a little. Binary formats help a lot with numbers.", "Protobuf writes small integers as one or two bytes and never sends field names."],
      solution: { format: "protobuf" },
    },
  ],
};

/* ------------------------------------------------------------------ module 20 */

export const apiStyles: Lab = {
  slug: "api-pick-a-style",
  module: 20,
  title: "Pick the right API style",
  product: "Fitness app",
  summary: "One product, three audiences: partners, the mobile app and internal services. Choose REST, GraphQL or gRPC for each, then fix a slow screen and a GraphQL N+1.",
  difficulty: "medium",
  minutes: 30,
  tags: ["REST", "GraphQL", "gRPC", "BFF", "N+1"],
  steps: [
    {
      type: "intro",
      title: "Three audiences",
      body: `A fitness app has grown up. It now serves:

1. **Partners** (gyms, insurers) who pull workout summaries. Hundreds of companies, every language, little patience for tooling.
2. **The mobile app**, whose screens each show data from several services. Many users are on slow mobile networks.
3. **Internal services**: the workout service streams heart-rate samples to the analytics service, thousands per second, and every millisecond matters.

There is no single best style. You'll choose per audience.`,
    },
    {
      type: "quiz",
      title: "The partner API",
      body: "Partners integrate once and then forget about it for years. They use curl, Postman and whatever HTTP library their language ships with.",
      question: "Which style fits the public partner API best?",
      options: [
        { text: "REST over HTTP with JSON, described in OpenAPI", correct: true, why: "Right. Every language and tool speaks it, responses are cacheable by URL, and an OpenAPI document gives partners docs and generated clients. Stability matters more than flexibility here." },
        { text: "gRPC with Protobuf", why: "Fast, but partners would need protoc tooling and HTTP/2 end to end; browsers and many corporate proxies don't speak gRPC natively." },
        { text: "GraphQL", why: "Possible (GitHub and Shopify offer it), but it moves cost control onto you: a partner can write one very expensive query. For a simple, stable data feed REST is the easier contract." },
      ],
    },
    {
      type: "quiz",
      title: "Service to service",
      body: "The workout service sends a continuous stream of heart-rate samples to analytics inside your data centre. Both teams use the same monorepo.",
      question: "What should the two services use?",
      options: [
        { text: "REST, one POST per sample", why: "Thousands of tiny HTTP requests a second, each with headers and JSON parsing: a lot of overhead for no benefit." },
        { text: "gRPC with a client-streaming or bidirectional-streaming call", correct: true, why: "Right. One long-lived HTTP/2 stream carries compact Protobuf messages, with deadlines and generated typed clients. Internal traffic is where gRPC shines." },
        { text: "GraphQL subscriptions", why: "Subscriptions push data to clients; they're not built for high-rate ingestion between services." },
      ],
    },
    {
      type: "sim",
      title: "Measure it: the profile screen",
      body: "The profile screen shows a user, their 20 latest workouts and stats for each. Today the app calls REST endpoints one after another over a 200 ms mobile round trip. Get the screen under 400 ms with at most 5 database queries.",
      sim: "fetch-patterns",
      params: { style: "rest", posts: 20, rttMs: 200, parallel: 1, dataloader: false, fieldsUsedPct: 30, dbMs: 4 },
      locked: ["posts", "rttMs", "fieldsUsedPct", "dbMs"],
      goals: [
        { metric: "loadMs", op: "<=", value: 400, label: "Screen loads in ≤ 400 ms" },
        { metric: "queries", op: "<=", value: 5, label: "≤ 5 database queries" },
      ],
      hints: ["Look at the bars: what dominates, round trips or bytes?", "More parallel requests help, but the waves still wait on each other.", "Fetch the whole screen in one call: GraphQL with batched resolvers, ?include=, or a BFF endpoint."],
      solution: { style: "bff" },
    },
    {
      type: "sim",
      title: "Measure it: the N+1 query",
      body: "The team chose GraphQL. The app is fast now, but the database team is unhappy: every profile view runs dozens of queries. Fix the server, not the client.",
      sim: "fetch-patterns",
      params: { style: "graphql", posts: 20, rttMs: 200, parallel: 1, dataloader: false, fieldsUsedPct: 30, dbMs: 4 },
      locked: ["style", "posts", "rttMs", "fieldsUsedPct", "dbMs", "parallel"],
      goals: [{ metric: "queries", op: "<=", value: 5, label: "≤ 5 database queries per screen" }],
      hints: ["Each workout's stats resolver runs on its own.", "Collect all the ids a level of resolvers asks for, then run one query with WHERE id IN (...).", "Turn on DataLoader."],
      solution: { dataloader: true },
    },
    {
      type: "quiz",
      title: "Caching GraphQL",
      body: "Most GraphQL clients send queries as POST requests to a single /graphql URL, so CDNs and browsers can't cache them.",
      question: "How do teams make popular GraphQL queries cacheable?",
      options: [
        { text: "Persisted queries: register queries ahead of time and send GET /graphql?id=<hash>&variables=…", correct: true, why: "Right. A known query becomes a stable, short GET URL that CDNs can cache, and the server can refuse unregistered queries, which also helps security." },
        { text: "Cache every POST response at the CDN", why: "POST bodies differ per request and POST isn't cacheable by default; you'd risk serving one user's data to another." },
        { text: "You can't; GraphQL is uncacheable", why: "Clients cache by object id (normalised caches), and persisted queries make HTTP caching possible too." },
      ],
    },
  ],
};

/* ------------------------------------------------------------------ module 21 */

const bank = (limit: number | null) =>
  build({
    nodes: [
      ["client", "client"],
      ...(limit !== null ? [["rl", "limiter", { limitPerIp: limit }] as [string, "limiter", object]] : []),
      ["lb", "lb", { healthChecks: true }],
      ["api1", "server", { size: "l" }],
      ["api2", "server", { size: "l" }],
      ["api3", "server", { size: "l" }],
      ["cache", "cache", { hitRatio: 0.85 }],
      ["db", "db", { size: "m" }],
    ] as never,
    wires: [limit !== null ? "client>rl, rl>lb" : "client>lb", ...[1, 2, 3].map((i) => `lb>api${i}, api${i}>cache, api${i}>db`)].join(","),
  });

export const secureTheApi: Lab = {
  slug: "api-secure-a-bank",
  module: 21,
  title: "Lock down a banking API",
  product: "Neobank API",
  summary: "Find the broken object-level check, choose OAuth flows for an app and a batch job, set token lifetimes, fix CORS and stop credential stuffing at the edge.",
  difficulty: "medium",
  minutes: 35,
  tags: ["OWASP API Top 10", "OAuth 2", "JWT", "CORS", "rate limiting"],
  steps: [
    {
      type: "intro",
      title: "The audit",
      body: `A small bank's API passed its functional tests and is about to launch. You've been asked to review it before it does.

- \`GET /accounts/:id\` returns an account's balance and transactions.
- The mobile app signs users in; a nightly job exports statements to an accounting partner.
- Access tokens are JWTs that live **24 hours**.
- The web app on \`app.bank.example\` calls \`api.bank.example\`.

Each step is a finding from a real-world class of API bugs.`,
    },
    {
      type: "quiz",
      title: "Finding 1: whose account is it?",
      body: "A tester signs in as Alice, calls GET /accounts/1001 (hers), then changes the id to 1002. She gets Bob's balance. The token is valid and the endpoint requires authentication.",
      question: "What's the fix?",
      options: [
        { text: "Use random UUIDs instead of sequential ids", why: "Harder to guess, but ids leak through logs, URLs and shared links. Unguessable ids are defence in depth, not access control." },
        { text: "On every request, check that the account belongs to the caller (or that they have a role that allows it) before returning it", correct: true, why: "Right. This is Broken Object Level Authorization (BOLA), number 1 on the OWASP API Security Top 10 (2023). Authentication says who you are; each object access still needs an authorization check, ideally in one shared place." },
        { text: "Hide the account id in the request body instead of the URL", why: "Moving the id doesn't change who's allowed to read it; an attacker edits the body just as easily." },
      ],
    },
    {
      type: "quiz",
      title: "Finding 2: OAuth flows",
      body: "The mobile app currently asks for the user's password and sends it to the API. The nightly export job runs on a server with no user present.",
      question: "Which pair of OAuth 2 flows is right?",
      options: [
        { text: "App: authorization code with PKCE in the system browser. Job: client credentials.", correct: true, why: "Right. The app never sees the password, PKCE protects the code on a device that can't keep a secret, and the job authenticates as itself with its own narrowly scoped credentials. OAuth 2.1 makes PKCE mandatory for the code flow." },
        { text: "App: implicit flow. Job: the resource owner password grant with a service account.", why: "Both are out: the implicit flow leaks tokens in URLs and the password grant hands passwords to clients. Current best practice (and the OAuth 2.1 draft) drops both." },
        { text: "App: send the password over TLS, it's encrypted. Job: a long-lived admin API key.", why: "TLS protects the wire, not the app or its logs; and an all-powerful key that never expires is exactly what attackers look for." },
      ],
    },
    {
      type: "sim",
      title: "Finding 3: 24-hour tokens",
      body: "When a customer reports a stolen phone, support revokes the session, but the JWT keeps working until it expires. Make revoked access stop within 15 minutes without overloading the 5,000 req/s auth server.",
      sim: "token-lifetime",
      params: { users: 2_000_000, reqPerUserMin: 6, ttlMin: 1440, validation: "jwt", authCapRps: 5000 },
      locked: ["users", "reqPerUserMin", "authCapRps"],
      goals: [
        { metric: "revokedP99Min", op: "<=", value: 15, label: "Revoked tokens stop working within 15 min (p99)" },
        { metric: "authLoad", op: "<=", value: 0.8, label: "Auth server ≤ 80% busy" },
      ],
      hints: ["Watch the refresh rate as you shorten the lifetime: every client refreshes once per lifetime.", "Asking the auth server on every request is precise but expensive.", "A 10-15 minute access token with a refresh token, or a denylist checked from Redis, both work."],
      solution: { ttlMin: 15 },
    },
    {
      type: "quiz",
      title: "Finding 4: CORS",
      body: "The API answers every request with `Access-Control-Allow-Origin: <whatever Origin the request sent>` and `Access-Control-Allow-Credentials: true`, \"so the web app works\".",
      question: "Why is that dangerous, and what's the fix?",
      options: [
        { text: "Any website can make the user's browser call the API with their cookies and read the answer. Allow only exact, known origins like https://app.bank.example.", correct: true, why: "Right. Reflecting the Origin with credentials turns the same-origin policy off for everyone. Keep an allowlist of exact origins, and remember CORS only restrains browsers: the API still needs authentication and authorization." },
        { text: "It's fine: CORS is checked by the server, so attackers can't get around it", why: "CORS is enforced by the browser on the server's say-so. Here the server says yes to everyone." },
        { text: "Use Access-Control-Allow-Origin: * instead", why: "Browsers refuse * together with credentials, so the web app breaks, and * is wrong for a private API anyway." },
      ],
    },
    {
      type: "design",
      title: "Finding 5: credential stuffing",
      body: "Attackers replay leaked username/password pairs against the sign-in endpoint: 50,000 requests a second from a handful of IPs. Every attempt misses the cache and hits the database. Stop them at the edge without blocking customers behind shared office and mobile IPs.",
      starter: bank(null),
      test: {
        traffic: { reads: 10_000, writes: 100, bots: 50_000 },
        constraints: [ok, { type: "botsBlocked", minShare: 0.97 }, { type: "p99", maxMs: 100 }, { type: "uses", kind: "limiter" }],
      },
      hints: [
        "Add a Rate limiter and wire Client → Rate limiter → Load balancer (delete the old wire first).",
        "Set a per-IP limit in the inspector.",
        "Shared IPs send ~40 req/s, so stay well above that: around 100 req/s per IP. Real sign-in endpoints also limit per account and add CAPTCHAs after failures.",
      ],
      solution: bank(100),
    },
  ],
};

/* ------------------------------------------------------------------ module 22 */

export const evolveTheApi: Lab = {
  slug: "api-evolve-orders",
  module: 22,
  title: "Evolve an orders API without breaking anyone",
  product: "Food delivery API",
  summary: "Three years of mobile apps depend on your orders API. Tell safe changes from breaking ones, deprecate politely, fix drifting pages, make order creation safe to retry and handle webhooks.",
  difficulty: "medium",
  minutes: 35,
  tags: ["versioning", "deprecation", "pagination", "idempotency", "webhooks"],
  steps: [
    {
      type: "intro",
      title: "Old clients never die",
      body: `Your orders API (\`/v1/orders\`) has been live for three years. About 8% of users never update their app, so builds from 2023 still call it every day. Restaurants integrate through webhooks.

The product team wants changes. Your job is to make them without breaking any of those clients.`,
    },
    {
      type: "quiz",
      title: "Safe or breaking?",
      body: "Four proposed changes to the order response.",
      question: "Which one can ship in v1 without a new version?",
      options: [
        { text: "Rename `total` to `amount`", why: "Every client reading `total` breaks. Renames need a new field plus a long overlap, or a new version." },
        { text: "Add a new optional field `tipAmount`", correct: true, why: "Right. Adding fields is safe as long as clients ignore fields they don't know (the tolerant reader rule). Document that rule from day one." },
        { text: "Change `createdAt` from a Unix timestamp to an ISO-8601 string", why: "Same name, different type: parsers crash. That's a breaking change." },
        { text: "Make `deliveryNote` required on POST /orders", why: "Old clients don't send it and start getting 400s. Tightening input rules is breaking; loosening them is safe." },
      ],
    },
    {
      type: "quiz",
      title: "Retiring an endpoint",
      body: "GET /v1/orders/:id/track is replaced by a WebSocket feed. You want to switch the old endpoint off in nine months.",
      question: "What's the most responsible plan?",
      options: [
        { text: "Announce it on the blog and switch it off on the date", why: "Most integrators never read the blog. You'll find out who depended on it when they page you." },
        { text: "Send Deprecation and Sunset headers (RFC 9745, RFC 8594) with a Link to the migration guide, track calls per client, contact the remaining users, and use brief planned brownouts before the date", correct: true, why: "Right. Machine-readable headers reach the code, usage data tells you who's left, and short brownouts surface forgotten callers while there's still time." },
        { text: "Keep it forever", why: "Every endpoint you keep is code to secure, test and run. Retire it, just carefully." },
      ],
    },
    {
      type: "sim",
      title: "Measure it: the order history export",
      body: "A restaurant's accounting tool exports its order history page by page while new orders keep arriving and some old ones get deleted (test orders). They complain about duplicate and missing orders, and the last pages time out. Fix it.",
      sim: "pagination",
      params: { mode: "offset", pageSize: 20, pages: 500, insertsPerPage: 3, deletesPerPage: 1, tableRows: 1e6 },
      locked: ["pageSize", "pages", "insertsPerPage", "deletesPerPage", "tableRows"],
      goals: [
        { metric: "duplicates", op: "<=", value: 0, label: "No order appears twice" },
        { metric: "missed", op: "<=", value: 0, label: "No order is skipped" },
        { metric: "lastPageMs", op: "<=", value: 5, label: "Last page query ≤ 5 ms" },
      ],
      hints: ["New orders push everything down; with offsets, the next page repeats rows.", "Deep offsets make the database walk every skipped row.", "Use a cursor: the last row's (created_at, id), sent back as ?after=."],
      solution: { mode: "cursor" },
    },
    {
      type: "sim",
      title: "Measure it: double orders",
      body: "On flaky networks, customers sometimes get charged and receive two identical orders. The app retries POST /orders when it doesn't hear back. Get double charges to zero without losing orders.",
      sim: "idempotent-retries",
      params: { requestLossPct: 3, responseLossPct: 5, retries: 3, key: "none", keyTtlHours: 24, lateRetryPct: 5, lateRetryHours: 2, atomic: false },
      locked: ["requestLossPct", "responseLossPct", "lateRetryPct", "lateRetryHours"],
      goals: [
        { metric: "duplicates", op: "<=", value: 0, label: "No double charges" },
        { metric: "lost", op: "<=", value: 5, label: "≤ 5 orders per 10k never placed" },
      ],
      hints: ["Turning retries off removes duplicates but loses orders.", "The server needs to recognise a retry: give each tap of Place order a key.", "Reuse the key on every attempt, and save it in the same transaction as the order."],
      solution: { key: "per-intent", atomic: true },
    },
    {
      type: "quiz",
      title: "Webhooks to restaurants",
      body: "You POST `order.created`, `order.updated` and `order.cancelled` events to each restaurant's URL. You retry with backoff when they don't return 2xx.",
      question: "What should you tell restaurants to do on their side?",
      options: [
        { text: "Verify the HMAC signature and timestamp, return 2xx quickly and process in the background, dedupe by event id, and fetch the latest order state if events arrive out of order", correct: true, why: "Right. Retries mean duplicates, networks reorder deliveries, and anyone can POST to a public URL. Signatures prove it's you; event ids make handling idempotent." },
        { text: "Process each event fully before responding, so you know it worked", why: "Slow handlers hit your timeout, you retry, and they process the event twice." },
        { text: "Trust events because they come from a known IP range", why: "IPs change and can be spoofed behind proxies; a signature over the body with a shared secret is the standard check." },
      ],
    },
  ],
};

/* ------------------------------------------------------------------ module 23 */

const storefront = (cdn: boolean) =>
  build({
    nodes: [
      ["client", "client"],
      ...(cdn ? ([["cdn", "cdn", { hitRatio: 0.8 }]] as const) : []),
      ["lb", "lb", { healthChecks: true }],
      ["api1", "server", { size: "l" }],
      ["api2", "server", { size: "l" }],
      ["cache", "cache", { hitRatio: 0.8 }],
      ["db", "db", { size: "m" }],
    ] as never,
    wires: `${cdn ? "client>cdn, cdn>lb" : "client>lb"}, lb>api1, lb>api2, api1>cache, api2>cache, api1>db, api2>db`,
  });

export const fastApi: Lab = {
  slug: "api-instant-storefront",
  module: 23,
  title: "Make a storefront feel instant",
  product: "Online shop",
  summary: "Tame search-as-you-type, choose cache headers per endpoint, put product pages behind a CDN for a sale, and keep a slow recommendations service from dragging pages down.",
  difficulty: "medium",
  minutes: 30,
  tags: ["debounce", "HTTP caching", "CDN", "circuit breaker"],
  steps: [
    {
      type: "intro",
      title: "A sale is coming",
      body: `A shop's web and mobile apps feel sluggish, and a big sale is two weeks away.

- The search box sends a request on every keystroke.
- Product pages are served straight from the API servers.
- The product page also shows recommendations from a separate service that slows down under load.

Make it fast for users, and cheap for you.`,
    },
    {
      type: "sim",
      title: "Measure it: search-as-you-type",
      body: "Get search under 5 requests per query, show final results within 450 ms of the last keystroke, and never flash stale results.",
      sim: "debounce",
      params: { strategy: "every-key", waitMs: 250, minChars: 1, serverP50: 80, serverP99: 600, cancelStale: false, clientCache: false },
      locked: ["serverP50", "serverP99"],
      goals: [
        { metric: "reqPerSearch", op: "<=", value: 5, label: "≤ 5 requests per search" },
        { metric: "finalDelayMs", op: "<=", value: 450, label: "Final results ≤ 450 ms after the last key" },
        { metric: "stale", op: "<=", value: 0.01, label: "≤ 1% of searches flash stale results" },
      ],
      hints: ["Debounce waits for a pause in typing before sending.", "A long wait saves requests but every search feels slower.", "Try a debounce of ~150 ms, start at 2 characters, and ignore out-of-date replies."],
      solution: { strategy: "debounce", waitMs: 150, minChars: 2, cancelStale: true },
    },
    {
      type: "quiz",
      title: "Cache headers per endpoint",
      body: "Three endpoints: GET /products/:id (same for everyone, changes a few times a day), GET /cart (per user), POST /checkout.",
      question: "Which set of headers is right?",
      options: [
        { text: "Products: `Cache-Control: public, max-age=60, stale-while-revalidate=300` plus an ETag. Cart: `Cache-Control: private, no-cache`. Checkout: not cacheable (`no-store`).", correct: true, why: "Right. Shared caches and CDNs may keep public product data briefly and revalidate cheaply with ETags (304 Not Modified). Per-user data must never land in a shared cache, and payment responses shouldn't be stored at all." },
        { text: "Everything: `Cache-Control: public, max-age=3600`", why: "A CDN would happily serve one user's cart to the next person, and prices would be an hour stale." },
        { text: "Everything: `no-store`, caching is too risky", why: "Safe, but you give up the cheapest performance win you have for the most-read pages." },
      ],
    },
    {
      type: "design",
      title: "Sale day: 40,000 product views a second",
      body: "Two API servers can't take sale-day traffic. Product pages are public and change rarely, so they can be served from the edge.",
      starter: storefront(false),
      test: {
        traffic: { reads: 40_000, writes: 200, bots: 0 },
        constraints: [ok, { type: "p99", maxMs: 100 }, { type: "uses", kind: "cdn" }, { type: "budget", maxUsd: 700, why: "no budget for new servers before the sale" }],
      },
      hints: ["Add a CDN in front of the load balancer: Client → CDN → Load balancer.", "With Cache-Control set, the CDN answers most product views itself.", "An 80% hit ratio leaves the servers with a fifth of the traffic."],
      solution: storefront(true),
    },
    {
      type: "quiz",
      title: "The slow recommendations service",
      body: "During the load test, the recommendations service slowed to 4 seconds per call, and product pages, which wait for it, slowed to 4 seconds too.",
      question: "What keeps product pages fast when recommendations are slow?",
      options: [
        { text: "A short timeout, a circuit breaker that stops calling it while it's failing, and a fallback (bestsellers) or loading recommendations after the page", correct: true, why: "Right. Recommendations are optional: fail fast, stop piling on a struggling service, show something reasonable, and let it recover." },
        { text: "Retry the call three times", why: "Retries triple the load on a service that's already drowning, and the page waits even longer." },
        { text: "Give recommendations a 30-second timeout so they always load", why: "Then every product page takes as long as the slowest dependency." },
      ],
    },
  ],
};

/* ------------------------------------------------------------------ module 24 */

export const latencyLab: Lab = {
  slug: "api-latency-budget",
  module: 24,
  title: "Budget an API call to the other side of the world",
  product: "Travel booking API",
  summary: "Users 10,000 km from your only region wait over a second for the first call. Estimate where the time goes, then cut handshakes, payload and server work until it fits the budget.",
  difficulty: "medium",
  minutes: 25,
  tags: ["latency", "RTT", "TLS 1.3", "HTTP/3", "edge"],
  steps: [
    {
      type: "intro",
      title: "Slow in Sydney",
      body: `A travel booking API runs in one region. Users in Australia, about **10,000 km** away, open the app and wait over a second for the first search results.

Light in fibre covers about 200 km per millisecond, and real routes are longer than straight lines. Before changing anything, estimate where the time goes.`,
    },
    {
      type: "quiz",
      title: "Estimate the round trip",
      body: "Round trip ≈ 2 × distance × route factor (~1.6) ÷ 200 km/ms, plus the last mile (~20 ms on mobile).",
      question: "Roughly how long is one round trip from Sydney to a server 10,000 km away?",
      options: [
        { text: "About 20 ms", why: "That's a round trip within one country, not across an ocean." },
        { text: "About 180 ms", correct: true, why: "Right: 2 × 10,000 × 1.6 ÷ 200 = 160 ms, plus ~20 ms last mile. Every handshake and every sequential request costs this much again." },
        { text: "About 1 second", why: "That's the whole first call, which includes several round trips. One round trip is much less." },
      ],
    },
    {
      type: "sim",
      title: "Measure it: the first call",
      body: "A new user's first call needs DNS, a new connection and the response. Get it under 450 ms without moving the data centre.",
      sim: "latency-budget",
      params: { distanceKm: 10000, lastMileMs: 20, dns: true, connection: "new", protocol: "h1-tls12", edge: false, payloadKB: 120, linkMbps: 20, dbQueries: 6, dbMs: 3, cpuMs: 15 },
      locked: ["distanceKm", "lastMileMs", "dns", "connection", "linkMbps", "dbMs", "cpuMs"],
      goals: [{ metric: "totalMs", op: "<=", value: 450, label: "First call ≤ 450 ms" }],
      hints: ["Count handshake round trips: TCP, then TLS.", "TLS 1.3 needs one round trip and HTTP/3 folds the transport and TLS handshakes together.", "Terminate connections at an edge near the user: handshakes become short trips, and the edge keeps warm connections to the origin."],
      solution: { protocol: "h3", edge: true },
    },
    {
      type: "sim",
      title: "Measure it: every call after",
      body: "Now the connection is warm and DNS is cached. Searches still take over 250 ms. Get them to 230 ms or less.",
      sim: "latency-budget",
      params: { distanceKm: 10000, lastMileMs: 20, dns: false, connection: "reused", protocol: "h2-tls13", edge: false, payloadKB: 120, linkMbps: 20, dbQueries: 6, dbMs: 3, cpuMs: 15 },
      locked: ["distanceKm", "lastMileMs", "dns", "connection", "linkMbps", "dbMs", "cpuMs"],
      goals: [{ metric: "totalMs", op: "<=", value: 230, label: "Search ≤ 230 ms" }],
      hints: ["The request itself still crosses the ocean: ~180 ms you can't remove from here.", "What's left is server work and the download.", "Run queries in parallel or fewer of them (2), and return only what the results screen shows (40 KB)."],
      solution: { dbQueries: 2, payloadKB: 40 },
    },
    {
      type: "quiz",
      title: "Under 100 ms",
      body: "The product team now wants searches under 100 ms for Australian users.",
      question: "What does it take?",
      options: [
        { text: "Serve them from a region (or edge cache) in or near Australia", correct: true, why: "Right. One round trip to the far region is already ~180 ms. Below that, the data has to be closer: a regional deployment, read replicas, or cached results at the edge." },
        { text: "Faster servers", why: "Server work is ~20 ms of the budget. The ocean is the rest." },
        { text: "A binary payload format", why: "It shrinks the download, but the request still has to cross the ocean and back." },
      ],
    },
  ],
};

/* ------------------------------------------------------------------ module 25 */

const searchStack = (cacheHit: number | null, servers: number) =>
  build({
    nodes: [
      ["client", "client"],
      ["lb", "lb", { healthChecks: true }],
      ...Array.from({ length: servers }, (_, i) => [`api${i + 1}`, "server", { size: "l" }] as [string, "server", { size: string }]),
      ...(cacheHit !== null ? [["cache", "cache", { hitRatio: cacheHit }] as [string, "cache", { hitRatio: number }]] : []),
      ["index", "db", { size: "l", shards: 2 }],
    ] as never,
    wires: ["client>lb", ...Array.from({ length: servers }, (_, i) => `lb>api${i + 1}, api${i + 1}>index${cacheHit !== null ? `, api${i + 1}>cache` : ""}`)].join(","),
  });

export const searchApi: Lab = {
  slug: "api-product-search",
  module: 25,
  title: "Design a product search API",
  product: "Marketplace search",
  summary: "Design search and suggestion endpoints, decide what goes in the query string, page through ranked results, and cache popular queries so the index survives a campaign.",
  difficulty: "medium",
  minutes: 30,
  tags: ["search", "autocomplete", "pagination", "caching"],
  steps: [
    {
      type: "intro",
      title: "The brief",
      body: `A marketplace with 20 million listings needs search for its app and website.

**Functional requirements**
- Search listings by text, with filters (category, price range, location) and sorting.
- Suggest completions while the user types.
- Open a listing from the results.

**Non-functional requirements**
- Suggestions in under 100 ms, full results in under 300 ms (p99).
- Peak: 30,000 searches a second during campaigns. A few hundred queries ("iphone", "sofa") make up most of the traffic.`,
    },
    {
      type: "api",
      title: "Design the endpoints",
      body: "Searching reads data and changes nothing, so it should be a GET with the query in the URL: bookmarkable, shareable and cacheable.",
      baseUrl: "https://api.market.example/v1",
      expect: [
        { goal: "Search listings (text, filters, sort, page)", methods: ["GET"], statuses: [200], pathMatch: "search|listings", why: "GET /search?q=sofa&category=furniture&max_price=300&sort=-relevance&cursor=… returns ranked results with a next cursor." },
        { goal: "Suggest completions for a prefix", methods: ["GET"], statuses: [200], pathMatch: "suggest|autocomplete|complete", why: "A separate, tiny endpoint (GET /suggest?q=so) can be served from a precomputed prefix index and cached hard." },
        { goal: "Get one listing", methods: ["GET"], statuses: [200], needsParam: true, pathMatch: "listings", why: "Results link to GET /listings/:id, which has its own caching and freshness rules." },
      ],
      solution: [
        { method: "GET", path: "/search", status: 200 },
        { method: "GET", path: "/suggest", status: 200 },
        { method: "GET", path: "/listings/:id", status: 200 },
      ],
    },
    {
      type: "quiz",
      title: "A filter for every field?",
      body: "A product manager asks for `?sort=` to accept any field and `?filter=` to accept any expression, \"for flexibility\".",
      question: "What's the better contract?",
      options: [
        { text: "A documented set of filters and sorts the index supports, with validation that rejects anything else with 400", correct: true, why: "Right. Every filter and sort needs index support to stay fast. An open-ended query language lets one client run an expensive scan, and once clients rely on it you can never take it away." },
        { text: "Accept anything; slow queries are the client's problem", why: "Slow queries are your problem: they share the index with everyone else's searches." },
        { text: "Let clients send raw search-engine queries in the body", why: "That leaks your engine's query language into the contract and invites injection and denial-of-service." },
      ],
    },
    {
      type: "quiz",
      title: "Page 1,000 of results",
      body: "Ranked search results change as listings are added and scores update, and the engine has to rank `offset + limit` results to return a deep page.",
      question: "How should search results be paginated?",
      options: [
        { text: "An opaque cursor (e.g. the last result's score and id, as `search_after`), plus a cap on how deep users can go", correct: true, why: "Right. Cursors keep pages stable and cheap; capping depth (most engines limit offset-based results to about 10,000) protects the cluster from scrapers." },
        { text: "?page=1000&size=20", why: "The engine must rank 20,020 results from every shard to return 20, and pages shift as scores change." },
        { text: "Return all matching results in one response", why: "Millions of results, megabytes per response: slow for everyone." },
      ],
    },
    {
      type: "design",
      title: "Campaign day: 30,000 searches a second",
      body: "Four API servers query a two-shard search index directly. During the campaign the index is overloaded. A few hundred popular queries dominate, so cache their results for a short time.",
      starter: searchStack(null, 4),
      test: {
        traffic: { reads: 30_000, writes: 300, bots: 0 },
        constraints: [ok, { type: "p99", maxMs: 100 }, { type: "uses", kind: "cache" }],
      },
      hints: ["The search index is the red card.", "Add a cache and wire every API server to it: popular queries are answered from memory.", "With a 70% hit ratio the index only sees the long tail."],
      solution: searchStack(0.7, 4),
    },
  ],
};

const uploads = (workers: number | null) =>
  build({
    nodes: [
      ["client", "client"],
      ["lb", "lb", { healthChecks: true }],
      ["api1", "server", { size: "m" }],
      ["api2", "server", { size: "m" }],
      ["db", "db", { size: "m" }],
      ...(workers !== null ? ([["q", "queue"], ["w", "worker", { workers }]] as const) : []),
    ] as never,
    wires: `client>lb, lb>api1, lb>api2, api1>db, api2>db${workers !== null ? ", api1>q, api2>q, q>w, w>db" : ""}`,
  });

export const fileApi: Lab = {
  slug: "api-video-uploads",
  module: 25,
  title: "Design an upload API for big videos",
  product: "Video sharing app",
  summary: "Design resumable upload sessions, measure uploads over flaky mobile networks, decide where the bytes should flow, and move processing off the request path.",
  difficulty: "medium",
  minutes: 30,
  tags: ["file uploads", "resumable", "presigned URLs", "queues"],
  steps: [
    {
      type: "intro",
      title: "The brief",
      body: `Creators upload videos from their phones: often **1-4 GB**, over mobile networks that drop every few minutes on a train.

- An upload must survive a dropped connection without starting again.
- After upload, the video is scanned and transcoded, which takes minutes.
- The app shows progress, then "processing", then "ready".`,
    },
    {
      type: "api",
      title: "Design the endpoints",
      body: "Treat an upload as a resource of its own (an upload session), separate from the video it becomes.",
      baseUrl: "https://upload.video.example/v1",
      expect: [
        { goal: "Start an upload session (size, type, name)", methods: ["POST"], statuses: [201], pathMatch: "upload", why: "POST /uploads returns 201 with the session id (and, often, where to send the bytes)." },
        { goal: "Send a chunk of bytes to the session", methods: ["PUT", "PATCH"], statuses: [200, 204, 308], needsParam: true, pathMatch: "upload", why: "PUT or PATCH /uploads/:id with a Content-Range (or an Upload-Offset header in the tus protocol). Google's resumable uploads answer 308 until the last chunk." },
        { goal: "Ask how many bytes the server already has", methods: ["GET"], statuses: [200], needsParam: true, pathMatch: "upload", why: "After a drop, the client asks GET /uploads/:id (or HEAD) for the offset and resumes from there." },
        { goal: "See whether the video is processed", methods: ["GET"], statuses: [200], needsParam: true, pathMatch: "video", why: "GET /videos/:id shows its state: processing, ready or failed. Long work returns a status resource; a webhook or push tells the client when it's done." },
      ],
      solution: [
        { method: "POST", path: "/uploads", status: 201 },
        { method: "PUT", path: "/uploads/:id", status: 308 },
        { method: "GET", path: "/uploads/:id", status: 200 },
        { method: "GET", path: "/videos/:id", status: 200 },
      ],
    },
    {
      type: "sim",
      title: "Measure it: 2 GB on a train",
      body: "Today the app uploads with one big PUT. With a connection drop every ten minutes, most uploads never finish. Make 99% finish and waste no more than 10% of bytes.",
      sim: "chunked-upload",
      params: { fileMB: 2000, linkMbps: 10, dropsPerHour: 6, mode: "single", chunkMB: 8, parallel: 1, rttMs: 120, maxAttempts: 5 },
      locked: ["fileMB", "linkMbps", "dropsPerHour", "rttMs", "maxAttempts"],
      goals: [
        { metric: "success", op: ">=", value: 0.99, label: "≥ 99% of uploads finish" },
        { metric: "overhead", op: "<=", value: 1.1, label: "≤ 10% extra bytes sent" },
      ],
      hints: ["A 2 GB file takes ~27 minutes at 10 Mbps. How likely is it to get through without a drop?", "If each piece is its own request, a drop only costs one piece.", "Switch to resumable uploads with chunks of a few MB."],
      solution: { mode: "resumable" },
    },
    {
      type: "quiz",
      title: "Where should the bytes go?",
      body: "Videos are stored in an object store (like S3 or Cloud Storage). Today every byte flows phone → API servers → object store.",
      question: "What's the usual design?",
      options: [
        { text: "The API authorises the upload and returns a short-lived presigned URL; the phone sends bytes straight to the object store", correct: true, why: "Right. The API stays in charge of who may upload what (size, type, expiry), but gigabytes never pass through your servers. Object stores already support multipart and resumable uploads." },
        { text: "Keep streaming through the API servers; just add more of them", why: "You pay twice for bandwidth and tie up servers for minutes per upload." },
        { text: "Make the bucket publicly writable", why: "Anyone could upload anything. Presigned URLs give the same directness with a scope and an expiry." },
      ],
    },
    {
      type: "design",
      title: "Processing without blocking",
      body: "When an upload completes, the API scans and transcodes it inside the request, and at 1,500 completions a second the database and servers fall over. Acknowledge quickly and process in the background.",
      starter: uploads(null),
      test: {
        traffic: { reads: 2000, writes: 1500, bots: 0 },
        constraints: [ok, { type: "p99", maxMs: 150 }, { type: "uses", kind: "queue" }, { type: "backlog", max: 50_000 }],
      },
      hints: ["Put a queue between the API and the work: API servers → Queue → Workers → Database.", "The API answers 202 Accepted as soon as the job is queued.", "Each worker handles ~400 jobs/s; add enough that the backlog doesn't grow."],
      solution: uploads(5),
    },
  ],
};

export const paymentsApi: Lab = {
  slug: "api-payments-gateway",
  module: 25,
  title: "Design a payments API",
  product: "Payment gateway",
  summary: "Model a payment as a stateful resource, make every write safe to retry, handle asynchronous card outcomes with webhooks, and version an API thousands of merchants depend on.",
  difficulty: "hard",
  minutes: 35,
  tags: ["payments", "idempotency", "state machines", "webhooks", "versioning"],
  steps: [
    {
      type: "intro",
      title: "The brief",
      body: `You're designing the API of a payment gateway that online shops integrate with.

- A payment may need several steps: authorise the card, maybe a 3-D Secure challenge in the customer's bank app, then capture.
- Some outcomes arrive minutes later, from the card network or the bank.
- Merchants' servers retry on timeouts. **Charging a customer twice is the worst bug you can have.**
- Thousands of merchants integrate once and expect it to keep working for years.`,
    },
    {
      type: "api",
      title: "Design the endpoints",
      body: "Model the payment as a resource with a state machine (requires_confirmation → requires_action → processing → succeeded / failed), not as one \"charge\" call.",
      baseUrl: "https://api.pay.example/v1",
      expect: [
        { goal: "Create a payment for an amount and currency", methods: ["POST"], statuses: [200, 201], pathMatch: "payment", why: "POST /payments (Stripe calls them PaymentIntents) creates the object that tracks one customer payment through every step." },
        { goal: "Confirm the payment with a payment method", methods: ["POST"], statuses: [200], needsParam: true, pathMatch: "confirm", why: "An action on the resource: POST /payments/:id/confirm. The answer may be succeeded, or requires_action with a 3-D Secure redirect." },
        { goal: "Read the payment's current state", methods: ["GET"], statuses: [200], needsParam: true, pathMatch: "payment", why: "GET /payments/:id is the source of truth; webhooks only tell you something changed." },
        { goal: "Refund a payment (fully or partly)", methods: ["POST"], statuses: [200, 201], pathMatch: "refund", why: "A refund is a new resource with its own lifecycle: POST /refunds {payment, amount}." },
      ],
      solution: [
        { method: "POST", path: "/payments", status: 201 },
        { method: "POST", path: "/payments/:id/confirm", status: 200 },
        { method: "GET", path: "/payments/:id", status: 200 },
        { method: "POST", path: "/refunds", status: 201 },
      ],
    },
    {
      type: "sim",
      title: "Measure it: merchants retry",
      body: "A merchant's SDK generates a new Idempotency-Key for every attempt, and keys are saved after the charge in a separate write. Get double charges to zero.",
      sim: "idempotent-retries",
      params: { requestLossPct: 2, responseLossPct: 6, retries: 3, key: "per-attempt", keyTtlHours: 24, lateRetryPct: 5, lateRetryHours: 2, atomic: false },
      locked: ["requestLossPct", "responseLossPct", "retries", "lateRetryPct", "lateRetryHours"],
      goals: [{ metric: "duplicates", op: "<=", value: 0, label: "No double charges" }],
      hints: ["A key that changes on every attempt can't identify a retry.", "Generate the key once per payment intent and reuse it.", "Store the key and the charge atomically, and keep keys longer than any retry."],
      solution: { key: "per-intent", atomic: true },
    },
    {
      type: "quiz",
      title: "The same key, a different body",
      body: "A merchant sends Idempotency-Key k1 with amount 50.00, then (a bug) the same key k1 with amount 75.00.",
      question: "What should the second request get?",
      options: [
        { text: "The saved response from the first request, for 50.00", why: "Silently ignoring a different body hides a serious merchant bug." },
        { text: "An error (409 or 422) saying the key was already used with different parameters", correct: true, why: "Right. Store a fingerprint of the request with the key; same key and same body replays the saved response, same key and different body is a client error. The IETF Idempotency-Key draft recommends exactly this." },
        { text: "A new charge for 75.00", why: "Then the key protects nothing." },
      ],
    },
    {
      type: "quiz",
      title: "Asynchronous outcomes",
      body: "After confirm returns `processing`, the bank decides a few minutes later. The merchant needs to ship the order only once the money is in.",
      question: "How should the merchant learn the outcome?",
      options: [
        { text: "Subscribe to a signed `payment.succeeded` / `payment.failed` webhook, handle it idempotently, and GET the payment if in doubt", correct: true, why: "Right. Webhooks push the change as it happens; the signature proves who sent it; and reading the resource resolves duplicates and out-of-order events." },
        { text: "Poll GET /payments/:id every second until it changes", why: "It works for one payment, but thousands of merchants polling every payment is a lot of wasted load. Use polling as a fallback, not the plan." },
        { text: "Keep the confirm request open until the bank answers", why: "Minutes-long requests hit every timeout between the merchant and you." },
      ],
    },
    {
      type: "quiz",
      title: "Versioning for thousands of merchants",
      body: "You need to change how amounts are represented. Some merchants integrated in 2019 and haven't touched their code since.",
      question: "Which approach do large payment APIs use?",
      options: [
        { text: "Pin each account to the API version it first used; send a version header to opt into newer behaviour; translate old versions on the server", correct: true, why: "Right. Stripe works this way: each account has a default version, requests can override it, and the server runs version-specific transformations. Since 2024 it ships monthly non-breaking releases and two major releases a year." },
        { text: "Change it in place and email everyone", why: "Merchants who miss the email start charging the wrong amounts." },
        { text: "Never change anything", why: "Then the API can't fix its mistakes or support new payment methods." },
      ],
    },
  ],
};

/** Labs for Part 3 (API design). */
export const API_LABS: Lab[] = [apiContract, apiStyles, secureTheApi, evolveTheApi, fastApi, latencyLab, searchApi, fileApi, paymentsApi];
