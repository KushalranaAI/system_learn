import { ArrowRight, BookOpen, Check, ChevronDown, FlaskConical } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { LESSONS, lessonById, outline } from "../content/lessons";
import { LABS } from "../labs";
import { loadProgress } from "../progress";
import { lessonsDone, nextLesson } from "../ui/resume";

function Ring({ value }: { value: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ring" viewBox="0 0 36 36" aria-hidden>
      <circle cx="18" cy="18" r={r} className="ring-track" />
      <circle cx="18" cy="18" r={r} className="ring-fill" strokeDasharray={`${c * value} ${c}`} />
    </svg>
  );
}

export function PathPage() {
  const modules = outline();
  const progress = loadProgress();
  const next = nextLesson(progress);
  const total = LESSONS.length;
  const doneCount = lessonsDone(progress);
  const [open, setOpen] = useState<number | null>(next?.module ?? 1);
  let part = "";
  return (
    <div className="page narrow">
      <header className="page-head">
        <p className="eyebrow">The path</p>
        <h1>System design, in the order real systems need it.</h1>
        <p className="lead">Each module starts with a problem a growing app runs into, then you build the fix.</p>
      </header>

      <div className="path-progress card">
        <div className="grow">
          <div className="row between">
            <b>Your progress</b>
            <span className="muted small">{doneCount} of {total} lessons</span>
          </div>
          <span className="meter big"><span style={{ width: `${(doneCount / Math.max(1, total)) * 100}%` }} /></span>
        </div>
        {next && (
          <Link className="btn primary" to={`/lesson/${next.lesson}`}>
            {doneCount ? "Continue" : "Start"}: {next.lesson} <ArrowRight size={16} />
          </Link>
        )}
      </div>

      {modules.map((m) => {
        const header = m.part !== part ? ((part = m.part), <h2 className="part">{m.part}</h2>) : null;
        const written = m.lessons.filter((l) => lessonById(l.id)).length;
        const done = m.lessons.filter((l) => progress.lessons[l.id]).length;
        const isOpen = open === m.number;
        const complete = written > 0 && done === written;
        return (
          <div key={m.number}>
            {header}
            <div className={`module${isOpen ? " open" : ""}${complete ? " complete" : ""}`}>
              <button className="module-head" onClick={() => setOpen(isOpen ? null : m.number)} aria-expanded={isOpen}>
                <span className="module-num">
                  <Ring value={written ? done / written : 0} />
                  <span>{complete ? <Check size={14} /> : m.number}</span>
                </span>
                <span className="module-title">{m.title}</span>
                <span className="module-meta">{written ? `${done}/${written}` : "soon"}</span>
                <ChevronDown size={18} className="chev" />
              </button>
              {isOpen && (
                <ol className="lessons">
                  {m.lessons.map((l) => {
                    const lesson = lessonById(l.id);
                    const isDone = !!progress.lessons[l.id];
                    const isNext = next?.lesson === l.id;
                    const inner = (
                      <>
                        <span className={`lesson-status${isDone ? " done" : ""}`}>{isDone ? <Check size={12} strokeWidth={3} /> : null}</span>
                        <span className="lesson-main">
                          <span className="lesson-title"><span className="lesson-id">{l.id}</span>{l.title}</span>
                          <span className="lesson-learn">{l.learn}</span>
                        </span>
                        <span className="lesson-meta">
                          {isNext && <span className="pill accent">Up next</span>}
                          {lesson ? <>{lesson.type === "lab" ? <FlaskConical size={13} /> : <BookOpen size={13} />} {lesson.minutes}m</> : "soon"}
                        </span>
                      </>
                    );
                    return (
                      <li key={l.id} className={`${lesson ? "" : "soon"}${isNext ? " next" : ""}`}>
                        {lesson ? <Link to={`/lesson/${l.id}`}>{inner}</Link> : <div>{inner}</div>}
                      </li>
                    );
                  })}
                  {LABS.filter((lab) => lab.module === m.number).map((lab) => {
                    const labDone = progress.labs[lab.slug]?.done.length === lab.steps.length;
                    return (
                      <li key={lab.slug} className="lab-link">
                        <Link to={`/labs/${lab.slug}`}>
                          <span className={`lesson-status lab${labDone ? " done" : ""}`}>{labDone ? <Check size={12} strokeWidth={3} /> : <FlaskConical size={12} />}</span>
                          <span className="lesson-main">
                            <span className="lesson-title">Interactive lab: {lab.title}</span>
                            <span className="lesson-learn">{lab.summary}</span>
                          </span>
                          <span className="lesson-meta">{lab.steps.length} steps</span>
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
