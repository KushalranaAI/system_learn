# Writing a lab

A lab is a TypeScript object in `src/labs/`, registered in `src/labs/index.ts`.

```ts
export const myLab: Lab = {
  slug: "my-lab",
  title: "Build a thing",
  product: "Thing",
  summary: "One sentence on the journey.",
  difficulty: "easy",
  minutes: 30,
  tags: ["caching"],
  steps: [ /* ... */ ],
};
```

## Step types

| type     | What the learner does | Passing |
|----------|-----------------------|---------|
| `intro`  | Reads Markdown        | Continue |
| `quiz`   | Picks an option; every option has a `why` | Picking the `correct` one |
| `api`    | Lists endpoints (method, path, status) | Every `expect` entry is matched |
| `design` | Builds on the canvas  | All `test.constraints` pass in the simulator |

### Design steps

```ts
{
  type: "design",
  title: "Handle 8,000 req/s on $400",
  body: "Markdown shown in the sidebar.",
  starter: build({ nodes: [["client", "client"]], wires: "" }), // optional: otherwise the previous design carries over
  test: {
    traffic: { reads: 8000, writes: 80, bots: 0 },
    incident: { type: "killKind", kind: "server" },             // optional: runs the 60 s timeline
    constraints: [
      { type: "successRate", min: 0.99 },
      { type: "p99", maxMs: 80 },
      { type: "budget", maxUsd: 400 },
      { type: "uses", kind: "lb", min: 1 },
      { type: "botsBlocked", minShare: 0.95 },
      { type: "recovery", maxSeconds: 20 },
      { type: "backlog", max: 200000 },
    ],
  },
  hints: ["Gentle nudge", "Bigger nudge", "Almost the answer"],
  solution: build({ nodes: [...], wires: "client>api, api>db" }),
  solutionResilience: { dbFailover: true },                     // if the solution needs a toggle
}
```

`build()` lays the graph out automatically. Wires are written `from>to`, separated by commas.

## Verify it

`npm test` runs `src/labs/labs.test.ts`, which checks for every design step that:
1. the reference `solution` passes, and
2. the starting design (the `starter`, or the previous step's solution) does **not** pass.

If test 2 fails, your step is too easy. Tighten a constraint until the learner has to change something.
