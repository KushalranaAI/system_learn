import { ArrowRight, Check, Clock, Layers } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { LABS, UPCOMING } from "../labs";
import { useChatSource } from "../chat/store";
import { loadProgress } from "../progress";

const FILTERS = ["all", "easy", "medium", "hard"] as const;

export function LabsPage() {
  const progress = loadProgress();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  useChatSource("labs", {
    label: `Labs · ${LABS.length} to choose from`,
    suggestions: ["Which lab should I start with?", "What will I learn in the easy labs?", "How do labs get checked?"],
    build: () => ({
      filter,
      labs: LABS.map((l) => ({ title: l.title, product: l.product, difficulty: l.difficulty, steps: l.steps.length, minutes: l.minutes, summary: l.summary, tags: l.tags, stepsCompleted: progress.labs[l.slug]?.done.length ?? 0 })),
    }),
  });
  const shown = LABS.filter((l) => filter === "all" || l.difficulty === filter);
  const finished = LABS.filter((l) => progress.labs[l.slug]?.done.length === l.steps.length).length;
  return (
    <div className="page">
      <header className="page-head">
        <p className="eyebrow">Labs</p>
        <h1>Design the systems you use every day.</h1>
        <p className="lead">Build it one step at a time, put it under load, fix what breaks. The simulator checks every step.</p>
      </header>

      <div className="toolbar-row">
        <div className="segmented" role="tablist">
          {FILTERS.map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
              {f === "all" ? `All ${LABS.length}` : f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <span className="muted small">{finished} of {LABS.length} completed</span>
      </div>

      <div className="cards three">
        {shown.map((lab) => {
          const p = progress.labs[lab.slug];
          const total = lab.steps.length;
          const done = p?.done.length ?? 0;
          const complete = done === total;
          return (
            <Link key={lab.slug} to={`/labs/${lab.slug}`} className={`card lab-card${complete ? " complete" : ""}`}>
              <div className="row between">
                <span className="lab-product">{lab.product}</span>
                <span className={`pill ${lab.difficulty}`}>{lab.difficulty}</span>
              </div>
              <h3>{lab.title}</h3>
              <p className="clamp">{lab.summary}</p>
              <div className="tags">{lab.tags.slice(0, 4).map((t) => <span key={t}>{t}</span>)}</div>
              <div className="lab-foot">
                <span className="muted small"><Layers size={13} /> {total} steps</span>
                <span className="muted small"><Clock size={13} /> {lab.minutes} min</span>
                <span className="grow" />
                <span className={`lab-cta${complete ? " good" : ""}`}>
                  {complete ? <><Check size={14} /> Done</> : done ? <>Continue {done}/{total}</> : <>Start <ArrowRight size={14} /></>}
                </span>
              </div>
              {done > 0 && !complete && <span className="meter"><span style={{ width: `${(done / total) * 100}%` }} /></span>}
            </Link>
          );
        })}
      </div>

      {filter === "all" && UPCOMING.length > 0 && (
        <section className="upcoming">
          <h2 className="section-title">Coming soon</h2>
          <div className="upcoming-list">
            {UPCOMING.map((u) => (
              <span key={u.title} className="upcoming-item" title={u.tags.join(" · ")}>
                <b>{u.title}</b> <span className="muted">{u.product}</span>
              </span>
            ))}
          </div>
          <p className="footnote">Want to write one? See <code>docs/writing-labs.md</code>.</p>
        </section>
      )}
    </div>
  );
}
