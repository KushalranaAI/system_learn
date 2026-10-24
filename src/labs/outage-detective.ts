import type { Lab } from "./types";

export const outageDetective: Lab = {
  slug: "outage-detective",
  module: 12,
  title: "Outage detective",
  product: "Payments platform",
  summary: "Five real-world distributed-systems failures. Read the symptoms, find the cause, choose the fix.",
  difficulty: "medium",
  minutes: 20,
  tags: ["timeouts", "retries", "idempotency", "clocks", "locks"],
  steps: [
    {
      type: "intro",
      title: "Your on-call week",
      body: `You're on call for a payments platform: an API gateway, an orders service, a payments service, and a bank integration.

Each step is an incident report. Pick the cause and the fix - each answer explains why.`,
    },
    {
      type: "quiz",
      title: "Monday: double charges",
      body: "Some customers were charged twice. Logs show the payments service called the bank, got no reply within 5 s, and retried with a new request. The bank shows two successful charges.",
      question: "What's the fix?",
      options: [
        { text: "Increase the timeout to 30 s", why: "That makes the problem rarer but not gone - a reply can still be lost after the bank charged the card." },
        { text: "Retry with the same idempotency key (or check status by that key) instead of a new request", correct: true, why: "Right. A timeout means 'unknown', not 'failed'. Reusing the key makes the bank return the first result instead of charging again." },
        { text: "Never retry payments", why: "Then every lost reply becomes a stuck or failed order. Retrying is fine - with idempotency." },
      ],
    },
    {
      type: "quiz",
      title: "Tuesday: the slow dependency",
      body: "The fraud-check service slowed to 8 s per call. Within minutes the whole API was down - even endpoints that never call fraud-check timed out.",
      question: "What let one slow dependency take down everything?",
      options: [
        { text: "The fraud service needed more servers", why: "Maybe - but the real failure is that its slowness spread to unrelated endpoints." },
        { text: "No timeout and a shared thread pool: every thread ended up waiting on fraud-check", correct: true, why: "Right. Add a short timeout, a bulkhead (its own small pool), and a circuit breaker with a fallback (e.g. allow small payments, queue big ones for review)." },
        { text: "The API gateway was misconfigured", why: "The gateway was fine - the API servers ran out of threads." },
      ],
    },
    {
      type: "quiz",
      title: "Wednesday: the retry storm",
      body: "The database had a 20-second blip. It came back healthy, but stayed at 100% for 15 minutes. Three layers (gateway, orders, payments) each retry 3 times with no delay.",
      question: "Why didn't the system recover when the database did?",
      options: [
        { text: "Retries multiplied the load: up to 27 database calls per user request, all at once", correct: true, why: "Right. Retry at one layer only, use exponential backoff with jitter and a retry budget, and shed load quickly while overloaded." },
        { text: "The database needed a restart", why: "It was healthy - it was simply being flooded by retries." },
        { text: "Caches were cold", why: "Possible in general, but the symptom here is retry amplification." },
      ],
    },
    {
      type: "quiz",
      title: "Thursday: the vanishing update",
      body: "Two regions accept writes to account settings and resolve conflicts with last-write-wins by server timestamp. A user's change 'disappeared' - a change made earlier in the other region won.",
      question: "What happened?",
      options: [
        { text: "Clock skew: the other region's clock was ahead, so its earlier write carried a later timestamp", correct: true, why: "Right. Wall clocks disagree. Use version vectors to detect concurrent writes, or give each account a single home region that orders its writes." },
        { text: "A network partition dropped the write", why: "The write arrived - it just lost the timestamp comparison." },
        { text: "The cache was stale", why: "The write itself was overwritten in the database, not hidden by a cache." },
      ],
    },
    {
      type: "quiz",
      title: "Friday: two leaders",
      body: "A nightly settlement job is guarded by a Redis lock with a 60 s TTL. One run paused for 90 s during a long GC. Another worker took the lock. Both wrote settlement files.",
      question: "What prevents this for good?",
      options: [
        { text: "A longer TTL", why: "Any TTL can be outlived by a long enough pause." },
        { text: "Fencing tokens checked by the storage, or a unique settlement-run constraint", correct: true, why: "Right. Each lock holder gets an increasing token and the storage rejects older tokens - or a unique (date) row makes a second run impossible." },
        { text: "Disable garbage collection", why: "Pauses also come from VM freezes, disk stalls and network hiccups - the design must tolerate them." },
      ],
    },
    {
      type: "sim",
      title: "Rerun Wednesday: stop the retry storm",
      body: "Wednesday's incident as a simulation: capacity drops to 30% for 15 seconds. With 3 immediate retries the system never recovers. Change the client and server policies - not the capacity - so it heals within 10 s and never more than 1.5x the normal load hits the server.",
      sim: "retry-storm",
      locked: ["clientRps", "capacity", "incidentFactor", "timeoutMs"],
      goals: [
        { metric: "recovery", op: "<=", value: 10, label: "Recovers within 10 s of the incident ending" },
        { metric: "amplification", op: "<=", value: 1.5, label: "Peak load ≤ 1.5x normal" },
      ],
      hints: [
        "Watch the orange line: after the incident, retries keep the offered load above capacity.",
        "Fewer retries, exponential backoff and jitter spread them out; a retry budget caps them.",
        "The server's long queue keeps serving requests clients already gave up on - shorten it to about 1 s (load shedding).",
      ],
      solution: { retries: 2, backoff: "exponential", jitter: true, budgetPct: 10, queueLimitSec: 1 },
    },
  ],
};
