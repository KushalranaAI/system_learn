import { build } from "../presets";
import type { Lab } from "./types";

const fleet = (n: number, size: string, healthChecks: boolean) =>
  build({
    nodes: [
      ["client", "client"],
      ["lb", "lb", { healthChecks }],
      ...Array.from({ length: n }, (_, i) => [`api${i + 1}`, "server", { size }] as [string, "server", { size: string }]),
      ["db", "db", { size: "xl" }],
    ],
    wires: ["client>lb", ...Array.from({ length: n }, (_, i) => `lb>api${i + 1}, api${i + 1}>db`)].join(","),
  });

export const dinnerRush: Lab = {
  slug: "dinner-rush",
  module: 4,
  title: "Survive the dinner rush",
  product: "Food ordering",
  summary: "From 2,000 to 25,000 requests a second every evening. Scale out on a budget and keep serving when a server dies.",
  difficulty: "easy",
  minutes: 25,
  tags: ["scale out", "load balancing", "health checks", "N+1"],
  steps: [
    {
      type: "intro",
      title: "The product",
      body: `A food ordering app. Afternoons are quiet; from 7 pm, everyone orders dinner at once.

- Afternoon: **2,000 req/s**. Dinner peak: **25,000 req/s** (about 4% are writes: orders and status updates).
- The database is already a big 16 vCPU Postgres ($720/month). It has room for this load.
- Budget for the whole system: **$1,100/month**.`,
    },
    {
      type: "quiz",
      title: "Before adding servers",
      body: "Today the app keeps logged-in users in a session map in the server's memory.",
      question: "What happens when you put a second server behind a load balancer?",
      options: [
        { text: "Nothing: the load balancer handles it", why: "The load balancer doesn't know about sessions. Requests land on whichever server it picks." },
        { text: "Users get randomly logged out", correct: true, why: "Right. A request that lands on the other server finds no session. Move sessions to Redis (or signed tokens) so any server can handle any request." },
        { text: "Every request gets slower", why: "Not inherently - the problem is correctness, not speed." },
      ],
    },
    {
      type: "design",
      title: "The dinner peak on $1,100",
      body: "Run the starter design at 25,000 req/s: one small server can't take it. Scale out behind a load balancer, within budget.",
      starter: build({ nodes: [["client", "client"], ["api", "server"], ["db", "db", { size: "xl" }]], wires: "client>api, api>db" }),
      test: {
        traffic: { reads: 24_000, writes: 1000, bots: 0 },
        constraints: [
          { type: "successRate", min: 0.99 },
          { type: "p99", maxMs: 100 },
          { type: "budget", maxUsd: 1100, why: "the database is $720 - you have $380 for everything else" },
          { type: "uses", kind: "server", min: 2, why: "one server is a single point of failure" },
        ],
      },
      hints: [
        "Add a load balancer: Client → Load balancer → API servers. Delete the old client wire first.",
        "Every API server needs its own wire to the database.",
        "Several mid-size servers are cheaper than a few big ones here: four 4 vCPU servers fit the budget.",
      ],
      solution: fleet(4, "m", false),
    },
    {
      type: "design",
      title: "Lose a server mid-rush",
      body: "At t=10s one API server crashes during the peak. Keep every second at 99% success.",
      test: {
        traffic: { reads: 24_000, writes: 1000, bots: 0 },
        incident: { type: "killKind", kind: "server" },
        constraints: [{ type: "successRate", min: 0.99 }],
      },
      hints: [
        "Run the test. Who is still sending traffic to the dead server?",
        "Select the load balancer and turn on health checks.",
        "After one server dies, the others must carry its share - check they stay under 100%.",
      ],
      solution: fleet(4, "m", true),
    },
    {
      type: "quiz",
      title: "Autoscaling at 7 pm",
      body: "You add an autoscaler targeting 70% CPU. New servers take 4 minutes to boot. Traffic triples between 7:00 and 7:05 pm.",
      question: "What's the most reliable way to handle the rush?",
      options: [
        { text: "Lower the target to 95% CPU so servers are used fully", why: "Near 100% utilisation, latency explodes and there's no room for the spike or a lost server." },
        { text: "Scheduled scaling before 7 pm, plus headroom", correct: true, why: "Right. The rush is predictable: scale up at 6:45 pm. Keep the target around 50-60% so the autoscaler only handles the surprises." },
        { text: "Rely on the autoscaler alone", why: "It reacts after load rises, and new servers arrive 4 minutes later - after the spike has already hit." },
      ],
    },
  ],
};
