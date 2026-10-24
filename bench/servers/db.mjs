// A database server: real SQLite (WAL mode, durable commits) behind HTTP, like a networked DB.
// GET /row/:id  → indexed point lookup      POST /row → durable single-row insert (one transaction)
// Usage: node db.mjs <port> <workers> <dbfile>
import cluster from "node:cluster";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";

const port = Number(process.argv[2] ?? 4102);
const workers = Number(process.argv[3] ?? 1);
const file = process.argv[4];

if (cluster.isPrimary) {
  cluster.schedulingPolicy = cluster.SCHED_RR;
  let ready = 0;
  for (let i = 0; i < workers; i++) cluster.fork();
  cluster.on("listening", () => {
    if (++ready === workers) console.log("READY");
  });
} else {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=10000; PRAGMA cache_size=-65536;");
  const get = db.prepare("SELECT id, name, price, stock FROM products WHERE id = ?");
  const put = db.prepare("INSERT INTO events (product_id, payload, created_at) VALUES (?, ?, ?)");
  http
    .createServer((req, res) => {
      if (req.method === "POST") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          try {
            put.run(Math.floor(Math.random() * 100000), body || "{}", Date.now());
            res.writeHead(201).end();
          } catch (e) {
            res.writeHead(503).end(String(e));
          }
        });
        return;
      }
      const id = Number(req.url.slice(req.url.lastIndexOf("/") + 1)) || 1;
      const row = get.get(id);
      const out = JSON.stringify(row ?? null);
      res.writeHead(row ? 200 : 404, { "content-type": "application/json" });
      res.end(out);
    })
    .listen(port);
}
