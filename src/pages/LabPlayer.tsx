import { ArrowLeft, ArrowRight, Check, ChevronLeft, CircleCheck, CircleX, Lightbulb, Play, Plus, Square, Trophy, Wand2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { REFERENCE_PROFILE, describeTest, explainDesign, explainTimeline, fmtRps, resolveIncident, runDesignTest, runTimeline, withProfile, type Advice, type Graph, type TestReport } from "../engine";
import { AdviceCard } from "../workspace/GuidePanel";
import { AiGuideCard } from "../ai/AiGuideCard";
import { designContext, labContext } from "../ai/context";
import { useAiExplanation } from "../ai/useAiExplanation";
import { labBySlug, type Lab, type LabStep } from "../labs";
import { checkApi } from "../labs/api-check";
import { loadProgress, updateProgress, type ApiRow } from "../progress";
import { useWorkspace } from "../state/workspace";
import { useChatSource } from "../chat/store";
import { Markdown } from "../ui/Markdown";
import { Workspace } from "../workspace/Workspace";
import { simById } from "../sims";
import { goalMet, type Params } from "../sims/types";
import { SimRunner } from "../sims/ui";

type DesignStep = Extract<LabStep, { type: "design" }>;

function labState(slug: string) {
  return loadProgress().labs[slug] ?? { step: 0, done: [] };
}

const STEP_KIND: Record<LabStep["type"], string> = { intro: "The brief", quiz: "Quick check", api: "Design the API", design: "Build", sim: "Experiment" };

export function LabPlayer() {
  const { slug = "" } = useParams();
  const lab = labBySlug(slug);
  const [stepIdx, setStepIdx] = useState(() => Math.min(labState(slug).step, (lab?.steps.length ?? 1) - 1));
  const [done, setDone] = useState<number[]>(() => labState(slug).done);

  useEffect(() => {
    updateProgress((p) => (p.labs[slug] = { ...labState(slug), ...p.labs[slug], step: stepIdx, done }));
  }, [slug, stepIdx, done]);

  const cur = lab?.steps[stepIdx];
  useChatSource(
    "lab",
    lab && cur
      ? {
          label: `Lab · ${lab.title} · step ${stepIdx + 1} of ${lab.steps.length}`,
          suggestions: cur.type === "quiz" ? ["Help me reason about this question without giving the answer"] : cur.type === "design" ? ["Give me a hint for this step", "What is this step asking me to build?"] : ["What is this step asking me to do?"],
          build: () => ({
            lab: lab.title,
            product: lab.product,
            summary: lab.summary,
            step: { number: stepIdx + 1, of: lab.steps.length, type: cur.type, title: cur.title },
            stepsCompleted: done.map((i) => lab.steps[i]?.title),
            brief: "body" in cur ? cur.body : undefined,
            ...(cur.type === "quiz" ? { question: cur.question, options: cur.options.map((o) => o.text), note: "The correct answer is deliberately not provided. Guide the learner's reasoning." } : {}),
            ...(cur.type === "api" ? { requirements: cur.expect.map((e) => e.goal) } : {}),
            ...(cur.type === "sim" ? { simulation: cur.sim, goals: cur.goals.map((g) => g.label) } : {}),
          }),
        }
      : null,
  );

  if (!lab)
    return (
      <div className="page narrow">
        <div className="empty-state">
          <h1>Lab not found</h1>
          <Link className="btn" to="/labs"><ArrowLeft size={16} /> All labs</Link>
        </div>
      </div>
    );

  const step = lab.steps[stepIdx];
  const markDone = () => setDone((d) => (d.includes(stepIdx) ? d : [...d, stepIdx]));
  const next = () => setStepIdx((i) => Math.min(lab.steps.length - 1, i + 1));
  const prev = () => setStepIdx((i) => Math.max(0, i - 1));
  const finished = done.length === lab.steps.length;

  const nav = (
    <div className="lab-nav">
      <Link to="/labs" className="icon-btn" title="All labs" aria-label="All labs"><ChevronLeft size={18} /></Link>
      <div className="lab-title">
        <small>{lab.product}</small>
        <b>{lab.title}</b>
      </div>
      <div className="steps">
        {lab.steps.map((s, i) => (
          <button
            key={i}
            className={`step-pill${i === stepIdx ? " current" : ""}${done.includes(i) ? " done" : ""}`}
            onClick={() => setStepIdx(i)}
            title={`Step ${i + 1} · ${STEP_KIND[s.type]}: ${s.title}`}
            aria-current={i === stepIdx ? "step" : undefined}
          >
            {done.includes(i) && i !== stepIdx ? <Check size={13} strokeWidth={3} /> : i + 1}
          </button>
        ))}
      </div>
      <span className="step-caption">{step.title}</span>
      <span className="grow" />
      {finished && <span className="pill good"><Trophy size={13} /> Lab complete</span>}
      <div className="row">
        <button className="icon-btn" onClick={prev} disabled={stepIdx === 0} title="Previous step" aria-label="Previous step"><ArrowLeft size={17} /></button>
        <button className="icon-btn" onClick={next} disabled={stepIdx === lab.steps.length - 1} title="Next step" aria-label="Next step"><ArrowRight size={17} /></button>
      </div>
    </div>
  );

  return (
    <div className="lab">
      {nav}
      {step.type === "design" ? (
        <DesignStepView key={stepIdx} lab={lab} stepIdx={stepIdx} step={step} passed={done.includes(stepIdx)} onPass={markDone} onNext={next} />
      ) : step.type === "sim" ? (
        <SimStepView key={stepIdx} lab={lab} stepIdx={stepIdx} step={step} passed={done.includes(stepIdx)} onPass={markDone} onNext={next} />
      ) : (
        <div className="page lab-page">
          <article className="lab-doc">
            <p className="eyebrow">Step {stepIdx + 1} of {lab.steps.length} · {STEP_KIND[step.type]}</p>
            <h1>{step.title}</h1>
            {step.type === "intro" && (
              <>
                <Markdown>{step.body}</Markdown>
                <div className="doc-actions">
                  <button className="btn primary big" onClick={() => (markDone(), next())}>Continue <ArrowRight size={17} /></button>
                </div>
              </>
            )}
            {step.type === "quiz" && <QuizView key={stepIdx} step={step} onPass={markDone} onNext={next} />}
            {step.type === "api" && <ApiView key={stepIdx} slug={lab.slug} step={step} onPass={markDone} onNext={next} />}
          </article>
        </div>
      )}
    </div>
  );
}

function QuizView({ step, onPass, onNext }: { step: Extract<LabStep, { type: "quiz" }>; onPass: () => void; onNext: () => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  const right = picked !== null && step.options[picked].correct;
  useChatSource("quiz-answer", {
    label: picked === null ? "The quiz question" : "Your quiz answer",
    build: () => (picked === null ? "The learner has not answered yet." : { picked: step.options[picked].text, wasCorrect: right }),
  });
  return (
    <>
      <Markdown>{step.body}</Markdown>
      <h3 className="question">{step.question}</h3>
      <div className="options">
        {step.options.map((o, i) => (
          <button
            key={i}
            className={`option${picked === i ? (o.correct ? " right" : " wrong") : ""}`}
            onClick={() => {
              setPicked(i);
              if (o.correct) onPass();
            }}
          >
            <span className="option-letter">
              {picked === i ? o.correct ? <Check size={14} strokeWidth={3} /> : <X size={14} strokeWidth={3} /> : String.fromCharCode(65 + i)}
            </span>
            <span className="option-text">
              <span>{o.text}</span>
              {picked === i && <span className="option-why">{o.why}</span>}
            </span>
          </button>
        ))}
      </div>
      {picked !== null && !right && <p className="hint">Not quite - read why, then try another answer.</p>}
      {right && (
        <div className="doc-actions">
          <button className="btn primary big" onClick={onNext}>Next step <ArrowRight size={17} /></button>
        </div>
      )}
    </>
  );
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const STATUSES = [200, 201, 202, 204, 301, 302, 304, 307, 308, 400, 401, 403, 404, 409, 422, 429];

function ApiView({ slug, step, onPass, onNext }: { slug: string; step: Extract<LabStep, { type: "api" }>; onPass: () => void; onNext: () => void }) {
  const [rows, setRows] = useState<ApiRow[]>(
    () => loadProgress().labs[slug]?.api ?? [{ method: "POST", path: "/links", status: 200 }],
  );
  const [results, setResults] = useState<ReturnType<typeof checkApi> | null>(null);
  useEffect(() => updateProgress((p) => (p.labs[slug] = { ...(p.labs[slug] ?? { step: 0, done: [] }), api: rows })), [slug, rows]);
  const set = (i: number, patch: Partial<ApiRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const pass = results?.every((r) => r.ok);
  useChatSource("api-draft", {
    label: "Your API draft",
    suggestions: ["Review my API design", "Is my REST design idiomatic?"],
    build: () => ({ endpoints: rows.map((r) => `${r.method} ${step.baseUrl}${r.path} -> ${r.status}`), lastCheck: results?.map((r) => `${r.ok ? "met" : "NOT met"}: ${r.goal}`) ?? "not checked yet" }),
  });
  return (
    <>
      <Markdown>{step.body}</Markdown>
      <div className="requirements">
        <span className="tag">Your API must</span>
        <ul>{step.expect.map((e) => <li key={e.goal}>{e.goal}</li>)}</ul>
        <span className="hint">Use <code>:name</code> for path parameters, e.g. <code>/items/:id</code>.</span>
      </div>
      <div className="table-wrap">
        <table className="api-table">
          <thead>
            <tr><th>Method</th><th>Path</th><th>Success status</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>
                  <select value={r.method} onChange={(e) => set(i, { method: e.target.value })} aria-label="Method">
                    {METHODS.map((m) => <option key={m}>{m}</option>)}
                  </select>
                </td>
                <td>
                  <span className="path-input">
                    <span className="muted">{step.baseUrl}</span>
                    <input value={r.path} onChange={(e) => set(i, { path: e.target.value })} placeholder="/path/:param" aria-label="Path" />
                  </span>
                </td>
                <td>
                  <select value={r.status} onChange={(e) => set(i, { status: +e.target.value })} aria-label="Status">
                    {STATUSES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </td>
                <td>
                  <button className="icon-btn sm danger" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} title="Remove" aria-label="Remove endpoint"><X size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="doc-actions">
        <button className="btn" onClick={() => setRows((rs) => [...rs, { method: "GET", path: "/", status: 200 }])}><Plus size={15} /> Endpoint</button>
        <span className="grow" />
        <button
          className={`btn ${pass ? "" : "primary"}`}
          onClick={() => {
            const r = checkApi(rows, step.expect);
            setResults(r);
            if (r.every((x) => x.ok)) onPass();
          }}
        >
          Check my API
        </button>
        {pass && <button className="btn primary" onClick={onNext}>Next step <ArrowRight size={16} /></button>}
      </div>
      {results && (
        <ul className="checks">
          {results.map((r) => (
            <li key={r.goal} className={r.ok ? "ok" : "fail"}>
              {r.ok ? <CircleCheck size={16} /> : <CircleX size={16} />}
              <span className="check-text">
                <span>{r.goal}</span>
                {!r.ok && <span className="check-detail">{r.why}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function startingGraph(lab: Lab, stepIdx: number): Graph {
  const saved = loadProgress().labs[lab.slug];
  const step = lab.steps[stepIdx] as DesignStep;
  if (saved?.graph && saved.graphStep === stepIdx) return saved.graph;
  if (step.starter) return step.starter;
  if (saved?.graph && (saved.graphStep ?? -1) < stepIdx) return saved.graph;
  for (let i = stepIdx - 1; i >= 0; i--) {
    const s = lab.steps[i];
    if (s.type === "design") return s.solution;
  }
  return { nodes: [], edges: [] };
}

function Hints({ hints, total, children, reveal }: { hints: string[]; total: number; reveal: () => void; children?: ReactNode }) {
  return (
    <section className="hints">
      <h4><Lightbulb size={14} /> Hints <span className="h-note">{hints.length}/{total}</span></h4>
      {hints.length > 0 && <ol>{hints.map((h) => <li key={h}>{h}</li>)}</ol>}
      <div className="row gap">
        {hints.length < total && <button className="btn small" onClick={reveal}>{hints.length ? "Another hint" : "Show a hint"}</button>}
        {children}
      </div>
    </section>
  );
}

function DesignStepView({
  lab, stepIdx, step, passed, onPass, onNext,
}: { lab: Lab; stepIdx: number; step: DesignStep; passed: boolean; onPass: () => void; onNext: () => void }) {
  const [report, setReport] = useState<TestReport | null>(null);
  const [hints, setHints] = useState(0);
  const [showSolution, setShowSolution] = useState(false);

  useEffect(() => {
    const ws = useWorkspace.getState();
    ws.setProfile("reference");
    ws.load(startingGraph(lab, stepIdx), step.test.traffic);
    ws.setResilience({ retries: true, dbFailover: false });
    return useWorkspace.subscribe((s, prev) => {
      if (s.graph !== prev.graph) updateProgress((p) => (p.labs[lab.slug] = { ...(p.labs[lab.slug] ?? { step: stepIdx, done: [] }), graph: s.graph, graphStep: stepIdx }));
    });
  }, [lab, stepIdx, step]);

  const incidentText = useMemo(() => {
    const i = step.test.incident;
    if (!i || i.type === "none") return null;
    if (i.type === "killKind") return `At t=10s the ${i.role === "primary" ? "primary database" : i.kind === "server" ? "first API server" : i.kind} dies`;
    if (i.type === "spike") return `At t=10s traffic jumps ${i.factor}x`;
    if (i.type === "cacheFlush") return "At t=10s the cache restarts empty";
    return null;
  }, [step]);

  const [coach, setCoach] = useState<{ why: string[]; advice: Advice[] } | null>(null);
  const [aiCtx, setAiCtx] = useState<unknown>(null);
  const ai = useAiExplanation(
    "The learner ran a lab test on their design. If it failed, explain exactly why each failed check failed and what to change on the canvas; if it passed, explain why the design works and the trade-offs it makes.",
    aiCtx,
  );
  const run = () => {
    const ws = useWorkspace.getState();
    const rep = runDesignTest(ws.graph, step.test, ws.resilience);
    setReport(rep);
    // Explain the result in words: what happened, why it failed, what to try.
    withProfile(REFERENCE_PROFILE, () => {
      const res = { ...ws.resilience, ...step.test.resilience };
      const guide = explainDesign(ws.graph, step.test.traffic, rep.result, res);
      const inc = step.test.incident && step.test.incident.type !== "none" ? resolveIncident(ws.graph, step.test.incident) : null;
      const tl = inc ? explainTimeline(ws.graph, step.test.traffic, runTimeline(ws.graph, step.test.traffic, inc, res), inc, res) : null;
      const failed = rep.lines.filter((l) => !l.ok);
      const why: string[] = rep.pass
        ? [guide.headline, ...(tl ? tl.story.slice(1, 3) : [])]
        : [...(tl ? tl.story : [guide.headline]), ...failed.map((l) => `Not met: ${l.label} (${l.detail}).`)];
      const advice = [...(tl?.advice ?? []), ...guide.advice].filter((a, i, all) => all.findIndex((b) => b.problem === a.problem) === i);
      if (!rep.pass && failed.some((l) => l.label.startsWith("Cost")))
        advice.push({ severity: "warn", problem: "The design is over budget.", why: `It costs $${rep.result.monthlyUsd}/month.`, fix: "Look for the most expensive component: is a smaller machine enough? Would a cache or CDN let a smaller database or fewer servers do the job?", tradeoff: "Cheaper designs usually run closer to capacity - less headroom for spikes and failures." });
      setCoach({ why, advice: rep.pass ? [] : advice.slice(0, 3) });
      setAiCtx(labContext(lab.title, step.title, step.body, rep, designContext(ws.graph, step.test.traffic, rep.result, res, guide)));
    });
    if (step.test.incident && step.test.incident.type !== "none") {
      ws.setIncident(resolveIncident(ws.graph, step.test.incident));
      ws.runIncident();
    }
    if (rep.pass) onPass();
  };

  useChatSource("lab-test", {
    label: report ? (report.pass ? "Test result · passed" : "Test result · not passed") : "The lab test",
    suggestions: report && !report.pass ? ["Why did my test fail?", "What should I change first?"] : ["How should I approach this step?"],
    build: () => ({
      traffic: step.test.traffic,
      incident: incidentText,
      mustSatisfy: step.test.constraints.map(describe),
      lastRun: report ? { passed: report.pass, checks: report.lines.map((l) => `${l.ok ? "met" : "NOT met"}: ${l.label} (${l.detail})`) } : "not run yet",
      hintsTheLearnerHasSeen: step.hints.slice(0, hints),
      note: "A reference solution exists but is deliberately not provided. Guide the learner with reasoning and hints.",
    }),
  });

  const t = step.test.traffic;
  const aiShown = ai.status === "done" || (!!ai.data && ai.status !== "error");
  const lines = report?.lines ?? step.test.constraints.map((c) => ({ label: describe(c), ok: false, detail: "" }));
  const ok = passed || !!report?.pass;
  const sidebar = (
    <div className="side lab-side">
      <div className="side-scroll">
        <div className="side-head">
          <p className="eyebrow">Step {stepIdx + 1} of {lab.steps.length} · Build</p>
          <h2>{step.title}</h2>
        </div>
        <Markdown>{step.body}</Markdown>

        <section className="scenario-box">
          <h4>The test</h4>
          <p className="small">{describeTest(t, step.test.incident as never)}</p>
          <div className="chips">
            <span className="pill">{fmtRps(t.reads)} reads/s</span>
            <span className="pill">{fmtRps(t.writes)} writes/s</span>
            {t.bots > 0 && <span className="pill">{fmtRps(t.bots)} bots/s</span>}
            {incidentText && <span className="pill warn">{incidentText}</span>}
          </div>
        </section>

        <section className="goal-box">
          <h4>
            To pass
            {report && <span className={`h-note ${report.pass ? "good" : "bad"}`}>{lines.filter((l) => l.ok).length}/{lines.length} met</span>}
          </h4>
          <ul className="checks">
            {lines.map((l, i) => (
              <li key={i} className={report ? (l.ok ? "ok" : "fail") : "todo"}>
                {report ? l.ok ? <CircleCheck size={16} /> : <CircleX size={16} /> : <Square size={15} />}
                <span className="check-text">
                  <span>{l.label}</span>
                  {report && l.detail && <span className="check-detail">{l.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {coach && <AiGuideCard {...ai} />}
        {coach && !aiShown && (
          <section className={`coach ${report?.pass ? "good" : "bad"}`}>
            <h4>{report?.pass ? "Why it works" : "What happened"}</h4>
            <ul>{coach.why.map((w) => <li key={w}>{w}</li>)}</ul>
            {coach.advice.length > 0 && <h4>What to try</h4>}
            {coach.advice.map((a, i) => <AdviceCard key={a.problem} a={a} open={i === 0} />)}
          </section>
        )}

        <Hints hints={step.hints.slice(0, hints)} total={step.hints.length} reveal={() => setHints(hints + 1)}>
          {hints >= step.hints.length && !showSolution && <button className="btn small ghost" onClick={() => setShowSolution(true)}>I'm stuck - show a solution</button>}
          {showSolution && (
            <button
              className="btn small warn"
              onClick={() => {
                const ws = useWorkspace.getState();
                ws.commit(JSON.parse(JSON.stringify(step.solution)));
                if (step.solutionResilience) ws.setResilience(step.solutionResilience);
              }}
            >
              <Wand2 size={14} /> Replace my design with a solution
            </button>
          )}
        </Hints>
      </div>
      <footer className="side-foot">
        {report?.pass ? (
          <p className="pass-banner"><Trophy size={16} /> Passed!{stepIdx === lab.steps.length - 1 ? " That's the whole lab." : ""}</p>
        ) : report ? (
          <p className="fail-banner"><CircleX size={16} /> Not yet - see what happened above.</p>
        ) : null}
        <div className="row gap nowrap">
          <button className={`btn grow ${ok ? "" : "primary"}`} onClick={run}><Play size={15} /> {report ? "Run again" : "Run test"}</button>
          {ok && stepIdx < lab.steps.length - 1 && <button className="btn primary grow" onClick={onNext}>Next step <ArrowRight size={16} /></button>}
        </div>
      </footer>
    </div>
  );
  return <Workspace left={sidebar} trafficLocked palette={step.palette} leftLabel="instructions" />;
}

function describe(c: DesignStep["test"]["constraints"][number]): string {
  switch (c.type) {
    case "successRate": return `Success rate ≥ ${(c.min * 100).toFixed(c.min > 0.999 ? 2 : 0)}%`;
    case "p99": return `p99 latency ≤ ${c.maxMs} ms`;
    case "budget": return `Cost ≤ $${c.maxUsd}/month`;
    case "uses": return `Uses ${c.min && c.min > 1 ? `${c.min}+` : "a"} ${c.kind}`;
    case "botsBlocked": return `Blocks ≥ ${Math.round(c.minShare * 100)}% of bot traffic`;
    case "recovery": return `Recovers within ${c.maxSeconds} s`;
    case "backlog": return `Queue backlog ≤ ${fmtRps(c.max)}`;
    case "consumerLag": return "Every consumer group keeps up";
    case "consistency": return "No order ends inconsistent";
  }
}

type SimStep = Extract<LabStep, { type: "sim" }>;

function SimStepView({ lab, stepIdx, step, passed, onPass, onNext }: { lab: Lab; stepIdx: number; step: SimStep; passed: boolean; onPass: () => void; onNext: () => void }) {
  const def = simById(step.sim);
  const [hints, setHints] = useState(0);
  const [met, setMet] = useState(false);
  const [initial, setInitial] = useState<Params>(step.params ?? {});
  const [version, setVersion] = useState(0);
  const onMetrics = useCallback(
    (m: Record<string, number>) => {
      const ok = step.goals.every((g) => goalMet(g, m));
      setMet(ok);
      if (ok) onPass();
    },
    [step, onPass],
  );
  if (!def) return <div className="page narrow">Unknown simulation "{step.sim}".</div>;
  return (
    <div className="simstep">
      <aside className="side lab-side">
        <div className="side-scroll">
          <div className="side-head">
            <p className="eyebrow">Step {stepIdx + 1} of {lab.steps.length} · Experiment</p>
            <h2>{step.title}</h2>
          </div>
          <Markdown>{step.body}</Markdown>
          <p className="hint">The simulation re-runs every time you change a setting. Meet every goal on the right to pass.</p>
          <Hints hints={step.hints.slice(0, hints)} total={step.hints.length} reveal={() => setHints(hints + 1)}>
            {hints >= step.hints.length && (
              <button className="btn small warn" onClick={() => { setInitial({ ...(step.params ?? {}), ...step.solution }); setVersion((v) => v + 1); }}>
                <Wand2 size={14} /> Load a solution
              </button>
            )}
          </Hints>
          <p className="hint">Explore it freely in the <Link to={`/sims/${def.id}`}>{def.title} playground</Link>.</p>
        </div>
        <footer className="side-foot">
          {met || passed ? <p className="pass-banner"><Trophy size={16} /> Goals met!</p> : <p className="hint">Change the settings until every goal is green.</p>}
          {(met || passed) && stepIdx < lab.steps.length - 1 && <button className="btn primary block" onClick={onNext}>Next step <ArrowRight size={16} /></button>}
        </footer>
      </aside>
      <main className="simstep-main">
        <SimRunner key={version} def={def} initial={initial} locked={step.locked} goals={step.goals} onMetrics={onMetrics} />
      </main>
    </div>
  );
}
