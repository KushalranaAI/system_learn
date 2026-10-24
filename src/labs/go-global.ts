import { build } from "../presets";
import type { Lab } from "./types";

const ha = (servers: number, replica: boolean) =>
  build({
    nodes: [
      ["client", "client"],
      ...(servers > 1 ? [["lb", "lb", { healthChecks: true }] as [string, "lb", object]] : []),
      ...Array.from({ length: servers }, (_, i) => [`api${i + 1}`, "server", { size: "l" }] as [string, "server", object]),
      ["db", "db", { size: "m", role: "primary" }],
      ...(replica ? [["rep", "db", { size: "m", role: "replica" }] as [string, "db", object]] : []),
    ] as never,
    wires: [
      servers > 1 ? "client>lb" : "client>api1",
      ...Array.from({ length: servers }, (_, i) => `${servers > 1 ? `lb>api${i + 1}, ` : ""}api${i + 1}>db${replica ? `, api${i + 1}>rep` : ""}`),
    ].join(","),
  });

export const goGlobal: Lab = {
  slug: "go-global",
  module: 18,
  title: "Go global",
  product: "B2B SaaS",
  summary: "Remove every single point of failure, then take the product to three regions with data residency and a 99.99% target.",
  difficulty: "hard",
  minutes: 30,
  tags: ["SPOFs", "failover", "error budgets", "multi-region", "data residency"],
  steps: [
    {
      type: "intro",
      title: "The situation",
      body: `A B2B SaaS runs in one region on **one API server and one database**. Customers are in India, Europe and the US.

- Enterprise customers now ask for **99.99%** availability.
- European customers require their data to stay in the **EU**.

First make one region robust, then go global.`,
    },
    {
      type: "quiz",
      title: "The cost of a nine",
      body: "99.99% availability allows how much downtime per 30 days?",
      question: "Pick the closest.",
      options: [
        { text: "About 43 minutes", why: "That's 99.9%." },
        { text: "About 4.3 minutes", correct: true, why: "Right. 0.01% of 30 days ≈ 259 seconds. One slow manual failover can spend the whole month's budget - automation is mandatory." },
        { text: "About 26 seconds", why: "That's roughly 99.999%." },
      ],
    },
    {
      type: "design",
      title: "Survive losing a server",
      body: "At t=10s the API server dies. Today that's a full outage. Make the worst second stay at 99% success.",
      starter: ha(1, false),
      test: {
        traffic: { reads: 6000, writes: 100, bots: 0 },
        incident: { type: "killKind", kind: "server" },
        constraints: [{ type: "successRate", min: 0.99 }, { type: "uses", kind: "server", min: 2 }],
      },
      hints: [
        "One server is a single point of failure. Add a second one.",
        "Put a load balancer in front (Client → LB → servers) and wire each server to the database.",
        "Turn on health checks so the load balancer stops sending traffic to the dead server.",
      ],
      solution: ha(2, false),
    },
    {
      type: "design",
      title: "Survive losing the database",
      body: "At t=10s the primary database dies. Recover automatically within 20 seconds.",
      test: {
        traffic: { reads: 6000, writes: 100, bots: 0 },
        incident: { type: "killKind", kind: "db", role: "primary" },
        constraints: [{ type: "recovery", maxSeconds: 20 }, { type: "uses", kind: "db", min: 2 }],
      },
      hints: [
        "Add a database and make it a read replica; wire both servers to it.",
        "Turn on 'Automatic DB failover' in the timeline bar.",
        "Failover takes 15 s to promote the replica; writes fail until then, reads continue from the replica.",
      ],
      solution: ha(2, true),
      solutionResilience: { dbFailover: true },
    },
    {
      type: "quiz",
      title: "Three regions, one dataset?",
      body: "You'll run Mumbai, Frankfurt and Virginia. EU tenants' data must stay in the EU; most tenants only ever work with their own data.",
      question: "How should data be placed?",
      options: [
        { text: "Active-active: every region accepts writes for every tenant", why: "Write conflicts everywhere, and EU data would be copied outside the EU." },
        { text: "Home each tenant in one region; keep small global data (logins, tenant directory) in a multi-region consensus store", correct: true, why: "Right. Each tenant's writes go to one place (no conflicts), EU tenants live in Frankfurt (residency), and only the small global data pays for global consensus." },
        { text: "Keep everything in Mumbai and add CDNs", why: "CDNs help static content, but writes stay far away for EU/US users and residency isn't met." },
      ],
    },
    {
      type: "quiz",
      title: "Region capacity",
      body: "Each region normally runs at 70% of its capacity. Frankfurt fails and its traffic shifts to the other two.",
      question: "What happens?",
      options: [
        { text: "Fine - the other regions absorb it", why: "Each would need to take an extra 35% on top of 70% - 105% of capacity." },
        { text: "The surviving regions overload: size each region to absorb a failed region's share (e.g. ≤ 66% with three regions)", correct: true, why: "Right. Redundancy needs spare capacity. With 3 regions, each should run at most ~66% so two can carry everything." },
        { text: "Traffic stays in Frankfurt until it recovers", why: "Then Frankfurt's users have a full outage - the point of multi-region is to shift them." },
      ],
    },
    {
      type: "quiz",
      title: "Moving the traffic",
      body: "During a drill, DNS failover with a 300 s TTL took 12 minutes for most users.",
      question: "What gets failover down to seconds?",
      options: [
        { text: "An anycast global load balancer in front of the regions", correct: true, why: "Right. The public IP never changes; the global LB stops routing to the unhealthy region in seconds. Fail back slowly and gradually." },
        { text: "Set the DNS TTL to 0", why: "Many resolvers and clients ignore very low TTLs, and it adds DNS load - it helps a bit, but not to seconds." },
        { text: "Ask users to refresh", why: "Not a failover strategy." },
      ],
    },
  ],
};
