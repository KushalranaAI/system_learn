# System Learn

**Learn system design by building it.** Wire clients, load balancers, API servers, caches, queues and databases on a
canvas, push traffic through them, break things on purpose, and watch what happens.

Built by **[Kushal Rana](https://www.linkedin.com/in/kushal-rana)** ·
[LinkedIn](https://www.linkedin.com/in/kushal-rana) · [X](https://x.com/KushalranaAI) ·
[Medium](https://kushalrana448.medium.com/) · [YouTube](https://www.youtube.com/@naaku-o2x)

- 🎛️ **Sandbox**: a free canvas with live traffic, animated request flow, cost and p99 latency. Components include
  load balancers, servers, caches, CDNs, rate limiters, replicated and sharded databases, queues and workers,
  **Kafka topics, consumer groups and saga orchestrators**.
- 🧭 **A built-in guide**: before you run, it describes the scenario; after, it explains what happened, why it failed,
  what to try (often with a one-click fix) and the trade-off of each fix - plus "what if" checks (traffic doubles,
  the cache restarts, a server or the database dies) computed by re-running the simulation.
- 💾 **Your own scenarios**: save a design with its traffic and incident, reload, overwrite, share as a link, export.
- 💥 **Incidents**: kill a server or database, flush the cache, or spike traffic, then watch a 60-second timeline with
  retries, failover and cache warm-up.
- 🧪 **Labs**: step-by-step challenges checked by the simulator (success rate, p99, budget, recovery time).
- 📚 **Path**: 19 modules and 129 written lessons, from "what is system design?" to replication, Kafka, multi-region
  and the classic algorithms under big systems.
- 🧪 **19 interactive labs**, one per module (from Module 2): simulator design challenges plus decision steps.
- 🔬 **21 simulations** that run real models in your browser: call chains (Monte Carlo), retry storms, quorums,
  consistent hashing, Kafka consumer lag, sagas under failure, event-time windows, and working Bloom filters,
  HyperLogLog, count-min sketches, Merkle trees, gossip, Raft elections, token buckets, skip lists, LSM vs B-trees,
  geohash search, Snowflake IDs, write-ahead-log group commit and cache stampedes - each with a plain-language guide. They're
  embedded in the lessons and used as checked lab steps.
- 🖥️ **My machine**: `npm run bench` (or the in-app button) starts real servers on your computer (a JSON API, a SQLite
  database server, a TCP cache), drives real load at them, measures CPU-bound jobs and fsync, and turns the results
  into the simulator's capacity numbers.
- ✨ **Optional AI**: paste your own OpenAI, Anthropic (Claude) or Azure OpenAI key on the **✨ AI** page. Then every
  built-in explanation gets an **Explain with AI** button (it never runs on its own), and a chat button at the bottom
  right opens a tutor that can see whatever screen you are on. Without a key, everything uses the built-in explanations.
- 🎬 **Presenter mode** (press `P`) for recording videos. The simulation is deterministic, so every take matches.

Runs entirely in your browser. No account, no backend, and progress stays in localStorage.

## AI explanations and chat (optional)

Open **✨ AI** in the top bar, pick a provider, paste a key, press **Test connection**, then **Save and use AI**.

- **Explain with AI** appears above the built-in explanation in the Guide, labs and simulations. Nothing is sent until you click it.
- **Ask the tutor** (the round button at the bottom right) answers free-form questions. Each screen tells it what you are
  looking at: your design, traffic and results in the sandbox; settings and metrics in a simulation; the text of a lesson;
  the brief and your last test in a lab (never the reference solution or quiz answers). Screens register this with
  `useChatSource` in `src/chat/store.ts`, so a new page only needs one call to be understood by the tutor.

| Provider | What you enter | Default model |
|---|---|---|
| Built-in | nothing | rule-based, free, offline |
| OpenAI | API key (`sk-…`), optional model | `gpt-4o-mini` |
| Anthropic (Claude) | API key (`sk-ant-…`), optional model | `claude-opus-5-5` |
| Azure OpenAI | endpoint, deployment name, API version, key | your deployment |

Privacy:

- The key is stored only in your browser: sessionStorage by default, localStorage if you tick "Remember".
- It is sent only to the provider you picked. OpenAI and Anthropic are called directly from the browser. Azure blocks
  browser calls (CORS), so they go through a small relay in the local dev server (`/api/ai-proxy` in `vite.config.ts`),
  which only forwards HTTPS requests to OpenAI, Anthropic and Azure OpenAI hosts.
- Keys are never put in share links, scenario exports, progress files or the repository.
- Each explanation is one API call billed to your account. Answers are cached, and requests wait until you stop
  editing for about a second.

If a call fails (bad key, network, a refusal), the panel says why and shows the built-in explanation instead. The Azure
relay only exists while `npm start` / `npm run dev` is running; a static build supports OpenAI and Anthropic directly.

## Quick start

One command does everything - installs dependencies, measures your machine once (~25 s), and opens the app:

```bash
npm start
```

`npm start -- --no-bench` skips the measurement, `--rebench` measures again, `--check` runs the tests first.

Other scripts:

| Command            | What it does                         |
|--------------------|--------------------------------------|
| `npm run dev`      | Dev server only (no install/benchmark) |
| `npm run verify`   | Tests + production build             |
| `npm test`         | Engine + lab verification tests      |
| `npm run build`    | Typecheck + static build to `dist/`  |
| `npm run preview`  | Serve the built site                 |
| `npm run bench`    | Measure this machine (~45 s) and write its capacity profile |

Requires Node.js 20+.

## Project layout

```
src/
  engine/      pure TypeScript simulator (no React): capacity profiles, solver, timeline, wiring rules, lab checks
  ai/          optional AI: provider settings, API clients (explain + chat), context builders
  chat/        the floating tutor and the per-screen context registry
  sims/        the 21 algorithm/system simulations (engine + view each) and shared charts/controls
  state/       zustand store for the canvas (undo/redo, playback) + auto layout
  workspace/   canvas UI: React Flow board, node cards, animated edges, inspector, traffic, timeline
  labs/        lab definitions as data + a test that proves every step is solvable
  pages/       home, path, lesson, labs, lab player, sandbox
  content/     loads Markdown lessons from /content
content/       lessons (Markdown + front-matter) and curriculum.md
bench/         real local benchmark: servers, load generator, orchestrator
docs/          how the simulator works, how to write labs and add components
```

## Contributing

- **Lessons**: add a Markdown file under `content/<module>/` (see `content/README.md`).
- **Labs**: see [docs/writing-labs.md](docs/writing-labs.md). `npm test` checks that your reference solution passes and
  that the starting design doesn't.
- **New components** (CDN, Kafka, sharded DB…): see [docs/simulator.md](docs/simulator.md#adding-a-component).

Please keep contributions original: learn from anywhere, but write in your own words.

## License

Code: MIT. Lesson content in `content/`: CC BY-SA 4.0. Copyright (c) 2026 Kushal Rana and contributors.

## About the author

System Learn is built and maintained by Kushal Rana.

- LinkedIn: <https://www.linkedin.com/in/kushal-rana>
- X: <https://x.com/KushalranaAI>
- Medium: <https://kushalrana448.medium.com/>
- YouTube: <https://www.youtube.com/@naaku-o2x>

The links and name in the footer of every page come from `src/brand.ts`.
