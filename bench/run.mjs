#!/usr/bin/env node
// Measures real capacities on this machine and writes the simulator's "measured" capacity profile.
//
//   API server  - a JSON HTTP service, run as 1, 2, 4 (and 8) processes → req/s per core + how it scales
//   Database    - SQLite (WAL, synchronous=FULL) behind HTTP → indexed reads/s (1, 2, 4 processes), durable writes/s
//   Cache       - single-threaded in-memory KV over TCP (like Redis) → ops/s
//   Workers     - a CPU-bound background job (hash 1 MB + compress 64 KB) → jobs/s per process
//   Disk        - fsync latency for 4 KB commits
//
// Results go to src/state/calibration/measured.json (used by the app) and bench/results/<timestamp>.json.
// Lines starting with "PROGRESS " are JSON progress events for the in-app runner.

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import zlib from "node:zlib";
import { DatabaseSync } from "node:sqlite";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const tmp = path.join(here, "tmp");
fs.mkdirSync(tmp, { recursive: true });
fs.mkdirSync(path.join(here, "results"), { recursive: true });
fs.mkdirSync(path.join(root, "src", "state", "calibration"), { recursive: true });

const QUICK = process.argv.includes("--quick");
const DURATION = QUICK ? 1500 : 3000;
const WARMUP = QUICK ? 300 : 600;
const cores = os.availableParallelism();
const procCounts = [1, 2, 4, ...(cores >= 12 ? [8] : [])].filter((k) => k < cores);
const STEPS = procCounts.length * 2 + 4;
let step = 0;

const progress = (label, extra = {}) => console.log(`PROGRESS ${JSON.stringify({ step: ++step, total: STEPS, label, ...extra })}`);
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (xs, q) => (xs.length ? xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))] : 0);
const round2 = (x) => {
  if (!x) return 0;
  const p = 10 ** Math.max(0, Math.floor(Math.log10(x)) - 1);
  return Math.round(x / p) * p;
};

function startServer(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--no-warnings", path.join(here, "servers", file), ...args.map(String)], { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => reject(new Error(`${file} did not start`)), 20000);
    child.stdout.on("data", (d) => {
      if (String(d).includes("READY")) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr.on("data", (d) => process.stderr.write(d));
    child.on("exit", (code) => code && reject(new Error(`${file} exited with ${code}`)));
  });
}

async function stop(child) {
  child.kill();
  await sleep(300);
}

async function load({ kind, port, method, path: p, threads, concurrency }) {
  const per = Math.max(1, Math.round(concurrency / threads));
  const results = await Promise.all(
    Array.from({ length: threads }, () =>
      new Promise((resolve, reject) => {
        const w = new Worker(path.join(here, "loadgen.mjs"), { workerData: { kind, port, method, path: p, concurrency: per, durationMs: DURATION, warmupMs: WARMUP } });
        w.on("message", resolve);
        w.on("error", reject);
      }),
    ),
  );
  const count = results.reduce((a, r) => a + r.count, 0);
  const errors = results.reduce((a, r) => a + r.errors, 0);
  const lat = results.flatMap((r) => r.lat);
  return { rps: count / (DURATION / 1000), errors, p50: pct(lat, 0.5), p99: pct(lat, 0.99) };
}

/** Amdahl-style fit: rps(k) = c1·k / (1 + α(k−1)). Returns the contention coefficient α. */
function fitAlpha(points) {
  const c1 = points[0].rps;
  const alphas = points.slice(1).map(({ k, rps }) => (c1 * k / rps - 1) / (k - 1)).filter(Number.isFinite);
  const a = alphas.length ? alphas.sort((x, y) => x - y)[Math.floor(alphas.length / 2)] : 0.1;
  return Math.min(0.6, Math.max(0.01, a));
}
const scale = (c1, alpha, v) => (c1 * v) / (1 + alpha * (v - 1));
// Clients cost about as much CPU as servers: give the load generator every core the servers don't use.
const loadThreads = (serverProcs) => Math.max(2, Math.min(12, cores - serverProcs));

async function benchApi() {
  const points = [];
  for (const k of procCounts) {
    progress(`API server with ${k} process${k > 1 ? "es" : ""}`);
    const srv = await startServer("api.mjs", [4101, k]);
    await sleep(200);
    const r = await load({ kind: "http", port: 4101, path: "/item/", threads: loadThreads(k), concurrency: 32 * k + 32 });
    await stop(srv);
    log(`  api  k=${k}: ${Math.round(r.rps).toLocaleString()} req/s  p50 ${r.p50.toFixed(2)} ms  p99 ${r.p99.toFixed(2)} ms`);
    points.push({ k, ...r });
  }
  return points;
}

function prepareDb() {
  const file = path.join(tmp, "bench.db");
  for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price REAL, stock INTEGER); CREATE TABLE events (id INTEGER PRIMARY KEY, product_id INTEGER, payload TEXT, created_at INTEGER); CREATE INDEX events_product ON events(product_id);");
  const ins = db.prepare("INSERT INTO products (id, name, price, stock) VALUES (?, ?, ?, ?)");
  db.exec("BEGIN");
  for (let i = 1; i <= 100000; i++) ins.run(i, `Product ${i}`, (i % 1000) + 0.99, i % 37);
  db.exec("COMMIT");
  db.close();
  return file;
}

async function benchDb(file) {
  const reads = [];
  for (const k of procCounts.filter((k) => k <= 4)) {
    progress(`Database reads with ${k} process${k > 1 ? "es" : ""}`);
    const srv = await startServer("db.mjs", [4102, k, file]);
    await sleep(200);
    const r = await load({ kind: "http", port: 4102, path: "/row/", threads: loadThreads(k), concurrency: 32 * k + 32 });
    await stop(srv);
    log(`  db read  k=${k}: ${Math.round(r.rps).toLocaleString()} reads/s  p99 ${r.p99.toFixed(2)} ms`);
    reads.push({ k, ...r });
  }
  progress("Database durable writes");
  const srv = await startServer("db.mjs", [4102, 4, file]);
  await sleep(200);
  const w = await load({ kind: "http", port: 4102, method: "POST", path: "/row/", threads: 2, concurrency: 16 });
  await stop(srv);
  log(`  db write: ${Math.round(w.rps).toLocaleString()} durable writes/s  p99 ${w.p99.toFixed(2)} ms  (errors ${w.errors})`);
  return { reads, write: w };
}

async function benchKv() {
  progress("Cache (in-memory KV over TCP)");
  const srv = await startServer("kv.mjs", [4103]);
  await sleep(200);
  const r = await load({ kind: "kv", port: 4103, threads: 3, concurrency: 96 });
  await stop(srv);
  log(`  kv: ${Math.round(r.rps).toLocaleString()} ops/s  p99 ${r.p99.toFixed(2)} ms`);
  return r;
}

function benchJob() {
  progress("Background worker job (CPU)");
  const big = crypto.randomBytes(1 << 20);
  const small = Buffer.from(JSON.stringify(Array.from({ length: 1500 }, (_, i) => ({ i, name: `row ${i}`, ok: i % 2 === 0 }))));
  const t0 = performance.now();
  let n = 0;
  while (performance.now() - t0 < DURATION / 1.5) {
    crypto.createHash("sha256").update(big).digest();
    zlib.deflateSync(small);
    n++;
  }
  const jobsPerSec = n / ((performance.now() - t0) / 1000);
  log(`  worker job: ${jobsPerSec.toFixed(0)} jobs/s per process (${(1000 / jobsPerSec).toFixed(2)} ms each)`);
  return { jobsPerSec, msPerJob: 1000 / jobsPerSec };
}

function benchFsync() {
  progress("Disk fsync latency");
  const f = path.join(tmp, "fsync.bin");
  const fd = fs.openSync(f, "w");
  const buf = Buffer.alloc(4096, 7);
  const lat = [];
  for (let i = 0; i < (QUICK ? 60 : 200); i++) {
    const t0 = performance.now();
    fs.writeSync(fd, buf);
    fs.fsyncSync(fd);
    lat.push(performance.now() - t0);
  }
  fs.closeSync(fd);
  fs.rmSync(f, { force: true });
  const r = { p50: pct(lat, 0.5), p99: pct(lat, 0.99) };
  log(`  fsync: p50 ${r.p50.toFixed(2)} ms  p99 ${r.p99.toFixed(2)} ms`);
  return r;
}

const t0 = Date.now();
log(`System Learn benchmark · ${os.cpus()[0].model} · ${cores} logical CPUs · ${Math.round(os.totalmem() / 2 ** 30)} GB RAM · Node ${process.version}`);
log("Real servers are started on 127.0.0.1:4101-4103; the load generator shares this machine's CPUs.\n");

const api = await benchApi();
const dbFile = prepareDb();
const db = await benchDb(dbFile);
const kv = await benchKv();
const job = benchJob();
const fsync = benchFsync();

const apiAlpha = fitAlpha(api);
const dbAlpha = fitAlpha(db.reads);
const apiC1 = api[0].rps;
const dbC1 = db.reads[0].rps;
const usd = { s: 40, m: 80, l: 160, xl: 320, "2xl": 640 };
const dbUsd = { s: 90, m: 180, l: 360, xl: 720 };
const serverSizes = [
  ["s", 2, 4], ["m", 4, 8], ["l", 8, 16], ["xl", 16, 32], ["2xl", 32, 64],
].map(([id, v, ram]) => ({ id, label: `${v} vCPU · ${ram} GB`, cap: round2(scale(apiC1, apiAlpha, v)), usd: usd[id] }));
// SQLite has one writer at a time; a Postgres-style server overlaps commits (group commit), which scales sub-linearly with cores.
const dbSizes = [
  ["s", 2, 8], ["m", 4, 16], ["l", 8, 32], ["xl", 16, 64],
].map(([id, v, ram]) => ({ id, label: `${v} vCPU · ${ram} GB`, readCap: round2(scale(dbC1, dbAlpha, v)), writeCap: round2(db.write.rps * Math.sqrt(v / 4)), usd: dbUsd[id] }));

const profile = {
  id: "measured",
  label: `Measured on this machine (${os.hostname()})`,
  source: `npm run bench · ${os.cpus()[0].model} · ${cores} logical CPUs · ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
  serverSizes,
  dbSizes,
  cacheCap: round2(kv.rps),
  workerCap: Math.max(1, Math.round(job.jobsPerSec)),
  measuredAt: new Date().toISOString(),
  machine: { cpu: os.cpus()[0].model, cores, ramGB: Math.round(os.totalmem() / 2 ** 30), os: `${os.type()} ${os.release()}`, node: process.version, hostname: os.hostname() },
  raw: { api, apiAlpha, db, dbAlpha, kv, job, fsync, durationMs: DURATION, quick: QUICK },
  method: {
    server: "rps(v) = rps(1 process) × v ÷ (1 + α(v−1)), α fitted from 1/2/4/8-process runs (Amdahl-style contention).",
    dbRead: "Same fit over 1/2/4 SQLite reader processes (WAL allows concurrent readers).",
    dbWrite: "Durable single-row commits/s measured with 4 processes (SQLite: one writer, fsync per commit), scaled by √(v/4) for group commit on bigger machines - extrapolated.",
    cache: "Single-threaded TCP key-value server, like one Redis node.",
    worker: "One process running a CPU-bound job: SHA-256 of 1 MB + deflate of 64 KB.",
  },
};

fs.writeFileSync(path.join(root, "src", "state", "calibration", "measured.json"), JSON.stringify(profile, null, 2));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
fs.writeFileSync(path.join(here, "results", `${stamp}.json`), JSON.stringify(profile, null, 2));
fs.rmSync(tmp, { recursive: true, force: true });

log("\nMeasured capacity profile:");
for (const s of serverSizes) log(`  API server ${s.label.padEnd(16)} ${s.cap.toLocaleString().padStart(9)} req/s`);
for (const s of dbSizes) log(`  Database   ${s.label.padEnd(16)} ${s.readCap.toLocaleString().padStart(9)} reads/s  ${s.writeCap.toLocaleString().padStart(8)} writes/s`);
log(`  Cache node ${"".padEnd(16)} ${profile.cacheCap.toLocaleString().padStart(9)} ops/s`);
log(`  Worker     ${"per process".padEnd(16)} ${profile.workerCap.toLocaleString().padStart(9)} jobs/s`);
log(`  Contention α: API ${apiAlpha.toFixed(3)}, DB reads ${dbAlpha.toFixed(3)}`);
log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(0)} s → src/state/calibration/measured.json`);
console.log(`PROGRESS ${JSON.stringify({ step: STEPS, total: STEPS, label: "done", done: true })}`);
process.exit(0);
