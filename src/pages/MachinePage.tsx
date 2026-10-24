import { CircleCheck, CircleX, Cpu, Play, Terminal, Timer } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { REFERENCE_PROFILE, fmtRps } from "../engine";
import { useChatSource } from "../chat/store";
import { MEASURED } from "../state/profile";

type Status = "idle" | "running" | "done" | "error" | "unavailable";

export function MachinePage() {
  const [log, setLog] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [prog, setProg] = useState<{ step: number; total: number; label: string } | null>(null);
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return void setApiOk(false); // no dev server on a static host
    fetch("./api/bench")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => setApiOk(!!j.available))
      .catch(() => setApiOk(false));
  }, []);
  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [log]);

  const run = async (quick: boolean) => {
    setLog([]);
    setStatus("running");
    setProg(null);
    try {
      const res = await fetch(`./api/bench${quick ? "?quick" : ""}`, { method: "POST" });
      if (!res.ok || !res.body) throw new Error(await res.text());
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("PROGRESS ")) setProg(JSON.parse(line.slice(9)));
          else if (line.startsWith("EXIT ")) setStatus(line.trim() === "EXIT 0" ? "done" : "error");
          else setLog((l) => [...l, line]);
        }
      }
    } catch (e) {
      setLog((l) => [...l, String(e)]);
      setStatus("error");
    }
  };

  const m = MEASURED;
  useChatSource("machine", {
    label: m ? `Your machine · ${m.machine.cpu}` : "Your machine · not measured",
    suggestions: ["What do these numbers mean?", "Why is my machine so much faster than the reference?", "How are the capacities calculated?"],
    build: () => ({
      measured: !!m,
      machine: m?.machine,
      measuredAt: m?.measuredAt,
      referenceServers: REFERENCE_PROFILE.serverSizes.map((s) => `${s.label}: ${s.cap} req/s`),
      measuredServers: m?.serverSizes.map((s) => `${s.label}: ${s.cap} req/s`),
      referenceDatabases: REFERENCE_PROFILE.dbSizes.map((s) => `${s.label}: ${s.readCap} reads/s, ${s.writeCap} writes/s`),
      measuredDatabases: m?.dbSizes.map((s) => `${s.label}: ${s.readCap} reads/s, ${s.writeCap} writes/s`),
      method: m?.method,
      runStatus: status,
    }),
  });
  const ratio = (mine: number, ref: number) => {
    const r = mine / ref;
    return <span className={`ratio ${r >= 1 ? "up" : "down"}`}>{r >= 10 ? Math.round(r) : r.toFixed(1)}×</span>;
  };
  return (
    <div className="page">
      <header className="page-head">
        <p className="eyebrow">My machine</p>
        <h1>Use your computer as the server.</h1>
        <p className="lead">The benchmark runs a real JSON API, a SQLite server and an in-memory cache on this machine, loads them, and turns the results into the simulator's capacities.</p>
      </header>

      <div className="bench-grid">
        <div className="card machine-run">
          <div className="machine-status">
            <span className={`status-icon ${m ? "good" : ""}`}><Cpu size={20} /></span>
            <div className="grow">
              <b>{m ? m.machine.cpu : "Not measured yet"}</b>
              <span className="muted small">{m ? `Last run ${m.measuredAt.slice(0, 10)} · ${m.machine.ramGB} GB RAM · ${m.machine.os}` : "The simulator is using the reference numbers."}</span>
            </div>
          </div>
          {apiOk === false ? (
            <div className="terminal-note">
              <Terminal size={16} />
              <div>
                <b>Run it from your terminal</b>
                <p className="hint">The in-app runner needs the dev server (<code>npm start</code>). Or run it directly:</p>
                <pre>npm run bench</pre>
              </div>
            </div>
          ) : (
            <>
              <div className="row gap">
                <button className="btn primary" disabled={status === "running" || apiOk === null} onClick={() => run(false)}>
                  <Play size={15} /> {m ? "Run again" : "Run benchmark"} <span className="btn-note">~45 s</span>
                </button>
                <button className="btn" disabled={status === "running" || apiOk === null} onClick={() => run(true)}>
                  <Timer size={15} /> Quick run <span className="btn-note">~25 s</span>
                </button>
              </div>
              {status === "done" && <p className="good small row gap"><CircleCheck size={15} /> Done - reloading to apply…</p>}
              {status === "error" && <p className="bad small row gap"><CircleX size={15} /> The benchmark failed - see the log.</p>}
              {status === "idle" && <p className="hint">Close heavy apps first. Laptops vary with turbo boost and temperature, so run it a couple of times.</p>}
              {prog && (
                <div className="progress">
                  <div className="row between small"><span>{prog.label}</span><span className="muted">{prog.step}/{prog.total}</span></div>
                  <span className="meter big"><span style={{ width: `${(prog.step / prog.total) * 100}%` }} /></span>
                </div>
              )}
              {log.length > 0 && <pre className="benchlog" ref={logRef}>{log.join("\n")}</pre>}
            </>
          )}
        </div>
      </div>
      {status === "done" && <Reload />}

      <h2 className="section-title">Capacities</h2>
      <div className="table-wrap">
        <table className="captable">
          <thead>
            <tr><th>Component</th><th>Reference</th><th>Measured here</th>{m && <th />}</tr>
          </thead>
          <tbody>
            {REFERENCE_PROFILE.serverSizes.map((s, i) => (
              <tr key={s.id}><td>API server <span className="muted">· {s.label}</span></td><td>{fmtRps(s.cap)} req/s</td><td>{m ? `${fmtRps(m.serverSizes[i].cap)} req/s` : "-"}</td>{m && <td>{ratio(m.serverSizes[i].cap, s.cap)}</td>}</tr>
            ))}
            {REFERENCE_PROFILE.dbSizes.map((s, i) => (
              <tr key={s.id}><td>Database <span className="muted">· {s.label}</span></td><td>{fmtRps(s.readCap)} reads · {fmtRps(s.writeCap)} writes/s</td><td>{m ? `${fmtRps(m.dbSizes[i].readCap)} reads · ${fmtRps(m.dbSizes[i].writeCap)} writes/s` : "-"}</td>{m && <td>{ratio(m.dbSizes[i].readCap, s.readCap)}</td>}</tr>
            ))}
            <tr><td>Cache node</td><td>{fmtRps(REFERENCE_PROFILE.cacheCap)} ops/s</td><td>{m ? `${fmtRps(m.cacheCap)} ops/s` : "-"}</td>{m && <td>{ratio(m.cacheCap, REFERENCE_PROFILE.cacheCap)}</td>}</tr>
            <tr><td>Worker process</td><td>{REFERENCE_PROFILE.workerCap} jobs/s</td><td>{m ? `${m.workerCap.toLocaleString()} jobs/s` : "-"}</td>{m && <td>{ratio(m.workerCap, REFERENCE_PROFILE.workerCap)}</td>}</tr>
          </tbody>
        </table>
      </div>
      <p className="footnote">
        The <Link to="/sandbox">sandbox</Link> can switch between these and the reference numbers. Labs always use the reference numbers so everyone gets the same test.
      </p>

      {m && (
        <>
          <details className="more card">
            <summary>What was measured</summary>
            <div className="more-body">
              <p className="hint">{m.source} · Node {m.machine.node}</p>
              <div className="table-wrap">
                <table className="captable">
                  <thead><tr><th>Run</th><th>Throughput</th><th>p50</th><th>p99</th></tr></thead>
                  <tbody>
                    {m.raw.api.map((r: { k: number; rps: number; p50: number; p99: number }) => (
                      <tr key={`a${r.k}`}><td>API server, {r.k} process{r.k > 1 ? "es" : ""}</td><td>{fmtRps(r.rps)} req/s</td><td>{r.p50.toFixed(2)} ms</td><td>{r.p99.toFixed(2)} ms</td></tr>
                    ))}
                    {m.raw.db.reads.map((r: { k: number; rps: number; p50: number; p99: number }) => (
                      <tr key={`d${r.k}`}><td>SQLite reads, {r.k} process{r.k > 1 ? "es" : ""}</td><td>{fmtRps(r.rps)} reads/s</td><td>{r.p50.toFixed(2)} ms</td><td>{r.p99.toFixed(2)} ms</td></tr>
                    ))}
                    <tr><td>SQLite durable writes</td><td>{fmtRps(m.raw.db.write.rps)} writes/s</td><td>{m.raw.db.write.p50.toFixed(2)} ms</td><td>{m.raw.db.write.p99.toFixed(2)} ms</td></tr>
                    <tr><td>KV cache over TCP</td><td>{fmtRps(m.raw.kv.rps)} ops/s</td><td>{m.raw.kv.p50.toFixed(2)} ms</td><td>{m.raw.kv.p99.toFixed(2)} ms</td></tr>
                    <tr><td>Worker job (SHA-256 1 MB + deflate)</td><td>{Math.round(m.raw.job.jobsPerSec)} jobs/s</td><td>{m.raw.job.msPerJob.toFixed(2)} ms</td><td>-</td></tr>
                    <tr><td>Disk fsync (4 KB)</td><td>-</td><td>{m.raw.fsync.p50.toFixed(2)} ms</td><td>{m.raw.fsync.p99.toFixed(2)} ms</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </details>
          <details className="more card">
            <summary>How the numbers are derived</summary>
            <div className="more-body">
              <ul className="method-list">
                {Object.entries(m.method).map(([k, v]) => <li key={k}><b>{k}:</b> {v}</li>)}
                <li>Contention fitted: API α = {m.raw.apiAlpha.toFixed(3)}, database reads α = {m.raw.dbAlpha.toFixed(3)} (0 = perfect scaling).</li>
              </ul>
              <p className="hint">These are loopback numbers: no real network, and the load generator competes with the servers for the same CPUs. Use them to compare designs on your hardware.</p>
            </div>
          </details>
        </>
      )}
    </div>
  );
}

function Reload() {
  useEffect(() => {
    const t = setTimeout(() => location.reload(), 1500);
    return () => clearTimeout(t);
  }, []);
  return null;
}
