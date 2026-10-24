import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronLeft, Clock, FlaskConical, Maximize2, Play } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { LESSONS, lessonById, outline } from "../content/lessons";
import { loadProgress, updateProgress } from "../progress";
import { Markdown } from "../ui/Markdown";
import { simsForLesson } from "../sims";
import { SimRunner } from "../sims/ui";

export function LessonPage() {
  const { id = "" } = useParams();
  return <LessonView key={id} id={id} />;
}

function LessonView({ id }: { id: string }) {
  const lesson = lessonById(id);
  const [done, setDone] = useState(() => !!loadProgress().lessons[id]);
  const [read, setRead] = useState(0);
  if (!lesson)
    return (
      <div className="page narrow">
        <div className="empty-state">
          <h1>Lesson not found</h1>
          <Link className="btn" to="/path"><ArrowLeft size={16} /> Back to the path</Link>
        </div>
      </div>
    );
  const idx = LESSONS.indexOf(lesson);
  const prev = LESSONS[idx - 1];
  const next = LESSONS[idx + 1];
  const moduleTitle = outline().find((m) => m.number === lesson.module)?.title;
  const toggle = () => {
    updateProgress((p) => (p.lessons[id] = !done));
    setDone(!done);
  };
  return (
    <div
      className="page narrow lesson"
      onScroll={(e) => {
        const el = e.currentTarget;
        setRead(el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight));
      }}
    >
      <div className="read-progress" style={{ transform: `scaleX(${read})` }} />
      <nav className="crumbs">
        <Link to="/path"><ChevronLeft size={14} /> Path</Link>
        <span>/</span>
        <span>Module {lesson.module}{moduleTitle ? ` · ${moduleTitle}` : ""}</span>
      </nav>
      <div className="lesson-meta-row">
        <span className="pill">{lesson.type === "lab" ? <FlaskConical size={12} /> : <BookOpen size={12} />} {lesson.type === "lab" ? "Lab" : "Lesson"} {lesson.lesson}</span>
        <span className="pill"><Clock size={12} /> {lesson.minutes} min</span>
        {done && <span className="pill good"><Check size={12} /> Completed</span>}
      </div>
      <Markdown>{lesson.body}</Markdown>
      {simsForLesson(lesson.lesson).map((def) => (
        <section key={def.id} className="embedded-sim">
          <div className="embedded-head">
            <span className="embedded-icon"><Play size={16} /></span>
            <div className="grow">
              <p className="eyebrow">Try it yourself</p>
              <h2>{def.title}</h2>
              <p className="muted">{def.blurb}</p>
            </div>
            <Link className="btn small ghost" to={`/sims/${def.id}`} title="Open full screen"><Maximize2 size={14} /> Full screen</Link>
          </div>
          <SimRunner def={def} compact />
        </section>
      ))}
      <div className="lesson-foot">
        <button className={`btn big ${done ? "done" : "primary"}`} onClick={toggle}>
          <Check size={18} /> {done ? "Completed" : "Mark as complete"}
        </button>
        <div className="pager">
          {prev ? (
            <Link className="pager-card" to={`/lesson/${prev.lesson}`}>
              <small><ArrowLeft size={12} /> Previous</small>
              <b>{prev.title}</b>
            </Link>
          ) : <span />}
          {next && (
            <Link className="pager-card next" to={`/lesson/${next.lesson}`} onClick={() => !done && (updateProgress((p) => (p.lessons[id] = true)), setDone(true))}>
              <small>Next <ArrowRight size={12} /></small>
              <b>{next.title}</b>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
