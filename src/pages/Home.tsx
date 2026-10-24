import { Activity, ArrowRight, BookOpen, Boxes, FlaskConical, Gauge, Route as RouteIcon, Siren, Spline, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";
import { LESSONS, outline } from "../content/lessons";
import { LABS } from "../labs";
import { loadProgress } from "../progress";
import { SIMS } from "../sims";
import { KindIcon } from "../ui/icons";
import { labsInProgress, lessonsDone, nextLesson } from "../ui/resume";

/** A tiny animated architecture: the product in one picture. */
function HeroDiagram() {
  const wires = [
    "M86,130 C120,130 120,130 150,130",
    "M206,130 C236,130 236,70 270,70",
    "M206,130 C236,130 236,190 270,190",
    "M326,70 C356,70 356,100 390,112",
    "M326,190 C356,190 356,160 390,148",
  ];
  const nodes: { x: number; y: number; kind: "client" | "lb" | "server" | "cache" | "db"; label: string; util?: number }[] = [
    { x: 30, y: 104, kind: "client", label: "Client" },
    { x: 150, y: 104, kind: "lb", label: "LB" },
    { x: 270, y: 44, kind: "server", label: "API", util: 0.46 },
    { x: 270, y: 164, kind: "server", label: "API", util: 0.52 },
    { x: 390, y: 104, kind: "db", label: "DB", util: 0.81 },
  ];
  return (
    <div className="hero-visual" aria-hidden>
      <svg viewBox="0 0 470 260" className="hero-svg">
        {wires.map((d, i) => (
          <g key={i}>
            <path d={d} className="hero-wire" />
            {[0, 1, 2].map((k) => (
              <circle key={k} r="3" className="hero-dot">
                <animateMotion dur="1.8s" repeatCount="indefinite" begin={`${-k * 0.6 - i * 0.2}s`} path={d} />
              </circle>
            ))}
          </g>
        ))}
      </svg>
      {nodes.map((n, i) => (
        <div key={i} className="hero-node" style={{ left: `${(n.x / 470) * 100}%`, top: `${(n.y / 340) * 100}%` }}>
          <KindIcon kind={n.kind} size={14} />
          <span>{n.label}</span>
          {n.util !== undefined && (
            <i className="hero-util">
              <b style={{ width: `${n.util * 100}%`, background: n.util > 0.8 ? "var(--warm)" : "var(--good)" }} />
            </i>
          )}
        </div>
      ))}
      <div className="hero-metrics">
        <span><small>Success</small><b className="good">99.98%</b></span>
        <span><small>p99</small><b>42 ms</b></span>
        <span><small>Cost</small><b>$410/mo</b></span>
      </div>
    </div>
  );
}

const ENTRIES = [
  { to: "/path", icon: RouteIcon, title: "Follow the path", text: "Short lessons in the order a growing app needs them." },
  { to: "/labs", icon: FlaskConical, title: "Solve a lab", text: "Real products, real constraints, checked by the simulator." },
  { to: "/sandbox", icon: Boxes, title: "Open the sandbox", text: "A free canvas. Build anything and push traffic through it." },
  { to: "/sims", icon: Activity, title: "Run a simulation", text: "Focused experiments: hashing, quorums, retries, Kafka." },
];

const HOW = [
  { icon: Spline, title: "Wire it", text: "Traffic flows along your wires. Past 100% capacity, requests drop." },
  { icon: Gauge, title: "Load it", text: "Latency comes from queueing - it explodes past ~85% busy." },
  { icon: Siren, title: "Break it", text: "Kill a server, flush the cache, go viral. Watch it play out." },
  { icon: TrendingUp, title: "Fix it", text: "Every overload explains itself, with a fix and its trade-off." },
];

export function Home() {
  const modules = outline();
  const progress = loadProgress();
  const next = nextLesson(progress);
  const started = lessonsDone(progress) > 0 || labsInProgress(progress).length > 0;
  const openLabs = labsInProgress(progress).slice(0, 2);
  return (
    <div className="page home">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Open source · runs locally · no account</p>
          <h1>
            Learn system design by <em>building</em> it.
          </h1>
          <p className="lead">Wire servers, caches, queues and databases on a canvas. Push traffic through them, break things, and fix what fails.</p>
          <div className="row gap">
            <Link className="btn primary big" to={started && next ? `/lesson/${next.lesson}` : "/path"}>
              {started ? "Continue learning" : "Start learning"} <ArrowRight size={18} />
            </Link>
            <Link className="btn big" to="/sandbox?preset=single">Open the sandbox</Link>
          </div>
          <p className="hero-stats">
            <span><b>{modules.length}</b> modules</span>
            <span><b>{LESSONS.length}</b> lessons</span>
            <span><b>{LABS.length}</b> labs</span>
            <span><b>{SIMS.length}</b> simulations</span>
          </p>
        </div>
        <HeroDiagram />
      </section>

      {started && (
        <section className="resume">
          <h2 className="section-title">Pick up where you left off</h2>
          <div className="resume-row">
            {next && (
              <Link to={`/lesson/${next.lesson}`} className="resume-card">
                <span className="resume-icon"><BookOpen size={18} /></span>
                <span className="grow">
                  <small>Next lesson · {next.lesson}</small>
                  <b>{next.title}</b>
                </span>
                <ArrowRight size={18} className="muted" />
              </Link>
            )}
            {openLabs.map(({ lab, done }) => (
              <Link key={lab.slug} to={`/labs/${lab.slug}`} className="resume-card">
                <span className="resume-icon"><FlaskConical size={18} /></span>
                <span className="grow">
                  <small>Lab · step {done + 1} of {lab.steps.length}</small>
                  <b>{lab.title}</b>
                  <span className="meter"><span style={{ width: `${(done / lab.steps.length) * 100}%` }} /></span>
                </span>
                <ArrowRight size={18} className="muted" />
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="section-title">Four ways in</h2>
        <div className="entry-grid">
          {ENTRIES.map(({ to, icon: Icon, title, text }) => (
            <Link key={to} to={to} className="card entry">
              <span className="entry-icon"><Icon size={20} /></span>
              <h3>{title}</h3>
              <p>{text}</p>
              <span className="entry-go">Open <ArrowRight size={14} /></span>
            </Link>
          ))}
        </div>
      </section>

      <section className="how">
        <h2 className="section-title">How the simulator works</h2>
        <div className="how-grid">
          {HOW.map(({ icon: Icon, title, text }, i) => (
            <div key={title} className="how-step">
              <span className="how-num">{i + 1}</span>
              <Icon size={18} className="how-icon" />
              <b>{title}</b>
              <p>{text}</p>
            </div>
          ))}
        </div>
        <p className="footnote">All numbers are teaching approximations. Calibrate them on <Link to="/machine">your own machine</Link>.</p>
      </section>
    </div>
  );
}
