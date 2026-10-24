# Contributing to System Learn

Thanks for helping. Anyone can read, clone, fork and run this project. Changes reach `main` only through a pull
request that the maintainer reviews and merges, so you never need (or get) write access to this repository.

## The short version

1. **Fork** this repository (the Fork button at the top right of GitHub).
2. **Clone your fork** and create a branch:
   ```bash
   git clone https://github.com/<your-username>/system_learn.git
   cd system_learn
   git switch -c my-change
   ```
3. **Make your change**, then check it (see below).
4. **Push the branch to your fork** and open a **pull request** against `main` of this repository.
5. A maintainer reviews it. Automated checks run first. The first time you contribute, a maintainer has to approve
   those checks before they start; that is normal.

You can't push to this repository directly, and `main` is protected, so don't worry about breaking anything.

## Run it locally

You need Node.js 20 or newer (CI uses 22).

```bash
npm install
npm run dev        # the app with hot reload at http://localhost:5173
npm start          # one command for newcomers: installs, benchmarks your machine once (~25 s), then starts the app
```

Optional: to try the AI features, copy `.env.example` to `.env` and add your own key (see the README). `.env` is git-ignored;
never commit it or paste keys into an issue or pull request.

## Check your change before opening the pull request

```bash
npm run verify     # unit tests, type check and a production build
```

This is exactly what CI runs. If it passes on your machine it will pass there.

## What to work on

| Kind of change | Where | Guide |
|---|---|---|
| A new lesson or fix to a lesson | `content/` | [content/README.md](content/README.md) |
| A new lab | `src/labs/` | [docs/writing-labs.md](docs/writing-labs.md) |
| A new simulation | `src/sims/` | look at an existing one such as `hash-ring.tsx` |
| Simulator numbers or behaviour | `src/engine/` | [docs/simulator.md](docs/simulator.md) |
| The local AI-key relay | `server/` | covered by tests in `server/ai-relay.test.ts` |
| UI | `src/pages/`, `src/workspace/`, `src/styles.css` | reuse the design tokens at the top of `styles.css` |

Good first contributions: fix a typo or an unclear sentence in a lesson, improve an explanation, add a missing
`Try it` exercise, or report something that confused you.

## Guidelines

- **Keep it original.** Learn from any source you like, but write lessons and labs in your own words with your own
  examples. Lessons are licensed CC BY-SA 4.0 and code is MIT (see `LICENSE`); only submit work you have the right to share.
- **One topic per pull request.** Small changes are reviewed faster.
- **Tests for engine changes.** `src/engine` has no UI code and is fully unit tested; keep it that way.
- **Never commit secrets.** API keys belong only in your own browser. Don't add keys, tokens or `.env` files.
- **Match the surrounding code.** Same naming, comment density and style as the file you are editing.
- **Be kind.** Disagree with ideas, not people. Beginners ask the best questions.

## Reporting problems

- **A bug or an unclear lesson:** open an issue with what you did, what you expected and what happened. A screenshot
  or a shared scenario link (Sandbox → Share → Copy link) helps a lot.
- **A security problem:** please don't open a public issue. Use the repository's **Security → Report a vulnerability**
  button so it can be fixed before it is public.

## How pull requests are handled

- Only the maintainer can merge into `main`. Contributors, including collaborators, work through pull requests.
- CI (tests and build) must pass, and the maintainer must approve.
- Pull requests from first-time contributors need a maintainer to approve the automated checks before they run.
- Merged changes are deployed to GitHub Pages automatically.
