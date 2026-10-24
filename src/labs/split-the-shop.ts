import type { Lab } from "./types";

export const splitTheShop: Lab = {
  slug: "split-the-shop",
  module: 11,
  title: "Split the shop into services",
  product: "E-commerce",
  summary: "A monolith is slowing down six teams. Choose boundaries, data ownership and the first service to extract.",
  difficulty: "medium",
  minutes: 20,
  tags: ["microservices", "boundaries", "data ownership", "events"],
  steps: [
    {
      type: "intro",
      title: "The situation",
      body: `An online shop runs on one monolith with one Postgres database.

- **40 engineers in 6 teams.** Releases queue for days because everything ships together.
- A bug in **recommendations** crashed the app (and checkout) twice last month.
- Checkout must stay fast and reliable above all.`,
    },
    {
      type: "quiz",
      title: "Where to draw lines",
      body: "Two proposals for the first split.",
      question: "Which split is better?",
      options: [
        { text: "By layer: an API service, a business-logic service, a database service", why: "Every feature would change all three services and they'd always deploy together - a distributed monolith." },
        { text: "By capability: catalogue, ordering, payments, fulfilment, accounts, recommendations", correct: true, why: "Right. Most changes stay inside one capability, so teams can own and deploy their services independently." },
        { text: "One service per database table", why: "Far too fine-grained: every request would need dozens of network calls and no service could answer anything alone." },
      ],
    },
    {
      type: "quiz",
      title: "Sharing data",
      body: "The new Recommendations service needs to know what users bought.",
      question: "How should it get that data?",
      options: [
        { text: "Read the monolith's orders table directly", why: "Shared tables couple the services tightly: any schema change in orders can silently break recommendations." },
        { text: "Consume OrderPlaced events and keep its own store", correct: true, why: "Right. The monolith publishes facts; recommendations builds whatever model it needs, and can be down without affecting checkout." },
        { text: "Call the orders API for every recommendation request", why: "That adds a synchronous dependency to every page view, and puts recommendation load on orders." },
      ],
    },
    {
      type: "quiz",
      title: "Extract first",
      body: "You can extract one service this quarter.",
      question: "Which is the best first extraction?",
      options: [
        { text: "Ordering - it's the most important", why: "The most critical, most entangled part is the riskiest place to learn microservices." },
        { text: "Recommendations", correct: true, why: "Right. It has caused outages, its interface is small ('products for user X'), and with a short timeout and a bestsellers fallback, its failures can no longer touch checkout." },
        { text: "All of them at once", why: "A big-bang rewrite multiplies risk; extract one, learn, then continue." },
      ],
    },
    {
      type: "api",
      title: "The recommendations contract",
      body: "Design the one endpoint the shop calls to get recommendations for a user, and the endpoint ops use to check the service is ready.",
      baseUrl: "http://recommendations.internal",
      expect: [
        { goal: "Get recommendations for a user", methods: ["GET"], statuses: [200], needsParam: true, why: "A read-only GET on the user (like /users/:id/recommendations) answered with 200. The caller sets a short timeout and falls back to bestsellers." },
        { goal: "Readiness check", methods: ["GET"], statuses: [200, 204], why: "A shallow GET (like /readyz) answered with 200/204, used by the load balancer to route only to ready instances." },
      ],
    },
    {
      type: "quiz",
      title: "Before moving traffic",
      body: "The new service is built. Checkout will call it on every page.",
      question: "What must be in place first?",
      options: [
        { text: "Nothing - ship it and watch the error rate", why: "Without traces and per-service metrics, you won't be able to tell where problems come from once requests span services." },
        { text: "Request ids, distributed tracing, per-service RED metrics, and a timeout + fallback on the call", correct: true, why: "Right. You can see across the boundary, and a slow or failing recommendations service degrades gracefully instead of slowing checkout." },
        { text: "A service mesh", why: "A mesh can help later, but for one new service it's a lot of machinery; tracing, metrics and a timeout are the essentials." },
      ],
    },
    {
      type: "sim",
      title: "Measure it: the checkout call chain",
      body: "Checkout calls 6 services in a row, each with p50 30 ms, p99 180 ms and 99.9% availability. Get checkout's p99 under 250 ms and its success rate to 99.7%. Only orders and payments are truly essential.",
      sim: "service-chain",
      locked: ["services", "p50", "tail", "availability"],
      goals: [
        { metric: "p99", op: "<=", value: 250, label: "Checkout p99 ≤ 250 ms" },
        { metric: "success", op: ">=", value: 0.997, label: "Checkout success ≥ 99.7%" },
      ],
      hints: [
        "Six sequential calls add their latencies and multiply their failure rates.",
        "Mark only the essential services as critical (2), and move the rest off the request path as events.",
        "The remaining essential calls are independent - make them in parallel.",
      ],
      solution: { mode: "parallel", critical: 2, asyncSideEffects: true },
    },
  ],
};
