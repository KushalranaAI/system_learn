// A small JSON API server, like a typical stateless service: parse the URL, build an object, serialise it.
// Usage: node api.mjs <port> <workers>
import cluster from "node:cluster";
import http from "node:http";

const port = Number(process.argv[2] ?? 4101);
const workers = Number(process.argv[3] ?? 1);
const TAGS = ["fast", "new", "popular", "sale", "eco"];
const DESC = "A well-made thing that people like to buy. ".repeat(14);

if (cluster.isPrimary) {
  cluster.schedulingPolicy = cluster.SCHED_RR;
  let ready = 0;
  for (let i = 0; i < workers; i++) cluster.fork();
  cluster.on("listening", () => {
    if (++ready === workers) console.log("READY");
  });
} else {
  http
    .createServer((req, res) => {
      const id = Number(req.url.slice(req.url.lastIndexOf("/") + 1)) || 0;
      const body = JSON.stringify({
        id,
        name: `Item ${id}`,
        price: (id % 1000) + 0.99,
        tags: TAGS.slice(0, (id % 5) + 1),
        stock: id % 37,
        description: DESC,
      });
      res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
      res.end(body);
    })
    .listen(port);
}
