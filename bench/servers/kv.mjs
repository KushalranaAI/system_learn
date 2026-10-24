// A single-threaded in-memory key-value server over TCP (like Redis): "GET key\n" → "value\n", pipelining allowed.
// Usage: node kv.mjs <port>
import net from "node:net";

const port = Number(process.argv[2] ?? 4103);
const store = new Map();
for (let i = 0; i < 100000; i++) store.set(`k${i}`, `v${i}:${"x".repeat(90)}`);

net
  .createServer((sock) => {
    sock.setNoDelay(true);
    let buf = "";
    sock.on("data", (chunk) => {
      buf += chunk;
      let nl;
      let out = "";
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        out += (store.get(line.slice(4)) ?? "") + "\n";
      }
      if (out) sock.write(out);
    });
    sock.on("error", () => {});
  })
  .listen(port, () => console.log("READY"));
