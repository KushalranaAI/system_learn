// Load generator (runs inside a worker thread): closed-loop clients, each sending one request at a time.
import http from "node:http";
import net from "node:net";
import { parentPort, workerData } from "node:worker_threads";

const { kind, port, method = "GET", path = "/item/", concurrency, durationMs, warmupMs } = workerData;
const start = performance.now();
const end = start + warmupMs + durationMs;
let count = 0;
let errors = 0;
const lat = [];

function record(t0) {
  const now = performance.now();
  if (now - start < warmupMs) return;
  count++;
  if (lat.length < 50000) lat.push(now - t0);
}

async function httpClient(agent) {
  while (performance.now() < end) {
    const t0 = performance.now();
    await new Promise((resolve) => {
      const req = http.request(
        { host: "127.0.0.1", port, method, path: `${path}${Math.floor(Math.random() * 100000) + 1}`, agent, headers: method === "POST" ? { "content-type": "application/json" } : {} },
        (res) => {
          res.resume();
          res.on("end", () => {
            if (res.statusCode < 400) record(t0);
            else errors++;
            resolve();
          });
        },
      );
      req.on("error", () => {
        errors++;
        resolve();
      });
      req.end(method === "POST" ? '{"event":"view","user":42}' : undefined);
    });
  }
}

function kvClient() {
  return new Promise((resolve) => {
    const sock = net.connect(port, "127.0.0.1");
    sock.setNoDelay(true);
    let t0 = 0;
    let buf = "";
    const send = () => {
      if (performance.now() >= end) return sock.end(), resolve();
      t0 = performance.now();
      sock.write(`GET k${Math.floor(Math.random() * 100000)}\n`);
    };
    sock.on("connect", send);
    sock.on("data", (d) => {
      buf += d;
      while (buf.includes("\n")) {
        buf = buf.slice(buf.indexOf("\n") + 1);
        record(t0);
        send();
      }
    });
    sock.on("error", () => {
      errors++;
      resolve();
    });
  });
}

const agent = new http.Agent({ keepAlive: true, maxSockets: concurrency });
const clients = Array.from({ length: concurrency }, () => (kind === "kv" ? kvClient() : httpClient(agent)));
await Promise.all(clients);
agent.destroy();
parentPort.postMessage({ count, errors, lat });
