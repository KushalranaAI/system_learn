import { Activity, ArrowRight, ChevronLeft } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { outline } from "../content/lessons";
import { SIMS, simById } from "../sims";
import { SimRunner } from "../sims/ui";

export function SimsPage() {
  const modules = outline();
  const title = (n: number) => modules.find((m) => m.number === n)?.title ?? "";
  const byModule = [...new Set(SIMS.map((s) => s.module))].sort((a, b) => a - b);
  return (
    <div className="page">
      <header className="page-head">
        <p className="eyebrow">Simulations</p>
        <h1>Run the ideas, don't just read them.</h1>
        <p className="lead">Real models running in your browser: Monte Carlo sampling, queues, elections, Bloom filters, Merkle trees. Change a setting and it re-runs.</p>
      </header>
      {byModule.map((m) => (
        <section key={m} className="sim-group">
          <h2 className="part"><span className="part-num">{String(m).padStart(2, "0")}</span> {title(m)}</h2>
          <div className="cards three">
            {SIMS.filter((s) => s.module === m).map((s) => (
              <Link key={s.id} to={`/sims/${s.id}`} className="card sim-card">
                <span className="entry-icon"><Activity size={18} /></span>
                <h3>{s.title}</h3>
                <p className="clamp">{s.blurb}</p>
                <span className="lab-foot">
                  <span className="muted small">Lessons {s.lessons.join(", ")}</span>
                  <span className="grow" />
                  <span className="lab-cta">Run <ArrowRight size={14} /></span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function SimPage() {
  const { id = "" } = useParams();
  const def = simById(id);
  if (!def)
    return (
      <div className="page narrow">
        <div className="empty-state">
          <h1>Simulation not found</h1>
          <Link className="btn" to="/sims"><ChevronLeft size={16} /> All simulations</Link>
        </div>
      </div>
    );
  return (
    <div className="page wide">
      <nav className="crumbs">
        <Link to="/sims"><ChevronLeft size={14} /> Simulations</Link>
        <span>/</span>
        <span>Module {def.module}</span>
      </nav>
      <header className="sim-head">
        <h1>{def.title}</h1>
        <p className="lead">{def.blurb}</p>
        <div className="chips">
          {def.lessons.map((l) => <Link key={l} className="pill link" to={`/lesson/${l}`}>Lesson {l}</Link>)}
        </div>
      </header>
      <SimRunner key={def.id} def={def} />
    </div>
  );
}
