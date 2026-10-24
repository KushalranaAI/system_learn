#!/usr/bin/env node
// One command for everything: `npm start`
//   1. installs dependencies if needed
//   2. benchmarks this machine once (real servers on localhost, ~25 s) so the simulator can use your capacities
//   3. starts the app and opens it in your browser
// Flags: --no-bench (skip step 2), --rebench (benchmark again), --check (run tests first)
import { spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (cmd, a, opts = {}) => spawnSync(cmd, a, { cwd: root, stdio: "inherit", shell: process.platform === "win32", ...opts });
const step = (n, msg) => console.log(`\n\x1b[32m[${n}/3]\x1b[0m ${msg}`);

const [major] = process.versions.node.split(".").map(Number);
if (major < 20) {
  console.error(`System Learn needs Node.js 20 or newer (you have ${process.version}). Install it from https://nodejs.org and try again.`);
  process.exit(1);
}

step(1, "Checking dependencies…");
const nm = path.join(root, "node_modules");
const lock = path.join(root, "package-lock.json");
const stale = !fs.existsSync(nm) || (fs.existsSync(lock) && fs.statSync(lock).mtimeMs > fs.statSync(nm).mtimeMs + 1000);
if (stale) {
  if (run(npm, ["install", "--no-audit", "--no-fund"]).status !== 0) process.exit(1);
} else console.log("  up to date");

if (args.has("--check")) {
  console.log("  running tests…");
  if (run(npm, ["test", "--silent"]).status !== 0) process.exit(1);
}

step(2, "Measuring this machine…");
const measured = path.join(root, "src", "state", "calibration", "measured.json");
if (args.has("--no-bench")) console.log("  skipped (--no-bench)");
else if (fs.existsSync(measured) && !args.has("--rebench")) console.log("  already measured (run `npm start -- --rebench` to measure again)");
else {
  console.log("  starting real servers on localhost and loading them for ~25 s (close heavy apps for steadier numbers)");
  const b = run(process.execPath, [path.join(root, "bench", "run.mjs"), "--quick"]);
  if (b.status !== 0) console.log("  benchmark failed - the app will use the reference numbers. You can retry from the My machine page.");
}

step(3, "Starting System Learn → http://localhost:5173");
const vite = spawn(process.execPath, [path.join(root, "node_modules", "vite", "bin", "vite.js"), "--open"], { cwd: root, stdio: "inherit" });
vite.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => vite.kill(sig));
