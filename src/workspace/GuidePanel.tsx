import { ChevronDown, CircleCheck, Lightbulb, OctagonAlert, TriangleAlert, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";
import { AiGuideCard } from "../ai/AiGuideCard";
import { designContext, timelineContext } from "../ai/context";
import { useAiExplanation } from "../ai/useAiExplanation";
import { explainDesign, explainTimeline, type Advice } from "../engine";
import { useWorkspace } from "../state/workspace";
import { IssuesPanel } from "./IssuesPanel";
import { useSim } from "./sim";

const SEVERITY_ICON = { bad: OctagonAlert, warn: TriangleAlert, info: Lightbulb };

/** One problem: the headline is always visible, the explanation opens on demand. */
export function AdviceCard({ a, open: initiallyOpen = false }: { a: Advice; open?: boolean }) {
  const applyAction = useWorkspace((s) => s.applyAction);
  const [open, setOpen] = useState(initiallyOpen);
  const Icon = SEVERITY_ICON[a.severity];
  return (
    <div className={`advice ${a.severity}${open ? " open" : ""}`}>
      <button className="advice-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon size={16} className="advice-icon" />
        <span className="grow">{a.problem}</span>
        <ChevronDown size={16} className="chev" />
      </button>
      {open && (
        <div className="advice-body">
          <p><span className="tag">Why</span>{a.why}</p>
          <p><span className="tag">Try</span>{a.fix}</p>
          <p><span className="tag">Trade-off</span>{a.tradeoff}</p>
        </div>
      )}
      {a.action && (
        <button className="btn small fix-btn" onClick={() => applyAction(a.action!)}>
          <Wand2 size={14} /> {a.action.label}
        </button>
      )}
    </div>
  );
}

function QuickFix({ a }: { a: Advice }) {
  const applyAction = useWorkspace((s) => s.applyAction);
  return <button className="btn small" title={a.problem} onClick={() => applyAction(a.action!)}><Wand2 size={14} /> {a.action!.label}</button>;
}

const STEPS = [
  ["Add components", "from the rail on the left of the canvas."],
  ["Wire them", "by dragging from a card's right dot to the next card."],
  ["Set the traffic", "in the Traffic tab and watch the cards fill up."],
  ["Break something", "with an incident in the bar below, then press Run."],
];

function Onboarding() {
  return (
    <div className="onboarding">
      <h3>Build your first system</h3>
      <ol>
        {STEPS.map(([b, rest], i) => (
          <li key={b}><span className="step-num">{i + 1}</span><span><b>{b}</b> {rest}</span></li>
        ))}
      </ol>
      <p className="muted small">This guide then explains what will break first and how to fix it.</p>
    </div>
  );
}

export function GuidePanel() {
  const graph = useWorkspace((s) => s.graph);
  const traffic = useWorkspace((s) => s.traffic);
  const resilience = useWorkspace((s) => s.resilience);
  const playback = useWorkspace((s) => s.playback);
  const incident = useWorkspace((s) => s.incident);
  const profileId = useWorkspace((s) => s.profileId);
  const sim = useSim();
  const live = !playback.ticks;
  const guide = useMemo(
    () => explainDesign(graph, traffic, sim, resilience),
    // during playback, keep the steady-state guide
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph, traffic, resilience, profileId, live ? sim : null],
  );
  const done = playback.ticks && playback.index >= playback.ticks.length - 1;
  const story = useMemo(
    () => (playback.ticks && done ? explainTimeline(graph, traffic, playback.ticks, incident, resilience) : null),
    [playback.ticks, done, graph, traffic, incident, resilience],
  );

  const aiContext = useMemo(() => {
    if (playback.ticks && !done) return null;
    const base = designContext(graph, traffic, sim, resilience, guide);
    return story && playback.ticks ? timelineContext(base, playback.ticks, incident, story.story) : base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guide, story, done]);
  const ai = useAiExplanation(
    story
      ? "The learner just ran an incident on this design. Tell what happened over time (use the timeline numbers), why, how to make the design survive it, and the trade-offs."
      : "Explain this system design and its simulated result to the learner: what is happening, the biggest problems with fixes and trade-offs, and what to try next.",
    aiContext,
    { enabled: graph.nodes.length > 1 },
  );
  const aiDone = ai.status === "done" || (!!ai.data && ai.status !== "error");

  if (!graph.nodes.length || (graph.nodes.length === 1 && graph.nodes[0].kind === "client")) return <Onboarding />;

  const quickFixes = (story?.advice ?? guide.advice).filter((a) => a.action);
  const advice = story ? story.advice : guide.advice.slice(0, 4);
  const tone = story ? story.tone : playback.ticks ? "" : guide.tone;
  const ToneIcon = tone === "good" ? CircleCheck : tone === "bad" ? OctagonAlert : TriangleAlert;
  return (
    <div className="guidepanel">
      <AiGuideCard {...ai} />
      {aiDone && quickFixes.length > 0 && (
        <div className="quickfixes">
          <span className="tag">Quick fixes</span>
          {quickFixes.slice(0, 3).map((a) => <QuickFix key={a.problem} a={a} />)}
        </div>
      )}
      {aiDone ? null : story ? (
        <section className={`status-card ${story.tone}`}>
          <h3><ToneIcon size={16} /> What happened</h3>
          <ul>{story.story.map((s) => <li key={s}>{s}</li>)}</ul>
        </section>
      ) : playback.ticks ? (
        <section className="status-card running">
          <h3><span className="pulse" /> Running the incident…</h3>
          <p>Watch the cards and wires. The full story appears when the timeline ends.</p>
        </section>
      ) : (
        <section className={`status-card ${guide.tone}`}>
          <h3><ToneIcon size={16} /> {guide.headline}</h3>
          {guide.path.length > 0 && <p className="path-line">{guide.path.join(" ")}</p>}
        </section>
      )}

      {!aiDone && advice.length > 0 && (
        <section className="stack">
          <h4>{story ? "How to survive it" : "Fix next"}</h4>
          {advice.map((a, i) => <AdviceCard key={a.problem} a={a} open={i === 0} />)}
        </section>
      )}
      {!aiDone && !story && guide.advice.length === 0 && guide.tone === "good" && (
        <p className="hint">Nothing to fix at this load. Raise the traffic or run an incident to find the next weak spot.</p>
      )}

      {!story && guide.whatIfs.length > 0 && (
        <section className="stack">
          <h4>What if… <span className="h-note">re-simulated instantly</span></h4>
          <ul className="whatifs">
            {guide.whatIfs.map((w) => {
              const cls = w.success >= 0.99 ? "good" : w.success >= 0.9 ? "warm" : "bad";
              return (
                <li key={w.scenario} title={w.verdict}>
                  <div className="row between">
                    <span>{w.scenario}</span>
                    <b className={cls}>{Math.round(w.success * 100)}%</b>
                  </div>
                  <span className={`meter thin ${cls}`}><span style={{ width: `${w.success * 100}%` }} /></span>
                  <span className="whatif-verdict">{w.verdict}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <details className="signals">
        <summary>All signals <span className="count">{sim.issues.length}</span></summary>
        <IssuesPanel />
      </details>
    </div>
  );
}
