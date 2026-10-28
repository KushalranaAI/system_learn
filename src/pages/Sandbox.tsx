import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import { BookOpen, ChevronRight, Download, Link2, Plus, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Graph, Incident, Resilience, Traffic } from "../engine";
import { PRESET_CATEGORIES, type Preset } from "../presets";
import { SCENARIOS, scenarioById } from "../scenarios";
import { Markdown } from "../ui/Markdown";
import { loadProgress, updateProgress, type Scenario } from "../progress";
import { MEASURED, savedProfileId } from "../state/profile";
import { useChatSource } from "../chat/store";
import { useWorkspace } from "../state/workspace";
import { Workspace } from "../workspace/Workspace";

interface Shared {
  graph: Graph;
  traffic: Traffic;
  incident?: Incident;
  resilience?: Resilience;
  name?: string;
  description?: string;
}

function decodeShared(d: string): Shared | null {
  try {
    const v = JSON.parse(decompressFromEncodedURIComponent(d) ?? "");
    return v?.graph?.nodes ? v : null;
  } catch {
    return null;
  }
}

type Current = Pick<Preset, "title" | "blurb" | "tryThis" | "source" | "story" | "lesson">;

function applyScenario(s: Shared) {
  const ws = useWorkspace.getState();
  ws.load(s.graph, s.traffic);
  ws.setResilience(s.resilience ?? { retries: true, dbFailover: false });
  if (s.incident) ws.setIncident(s.incident);
}

export function Sandbox() {
  const [params, setParams] = useSearchParams();
  const fileRef = useRef<HTMLInputElement>(null);
  const presenter = useWorkspace((s) => s.presenter);
  const profileId = useWorkspace((s) => s.profileId);
  const [scenarios, setScenarios] = useState<Scenario[]>(() => loadProgress().scenarios ?? []);
  const [current, setCurrent] = useState<Current | null>(null);
  const [query, setQuery] = useState("");
  const [openCat, setOpenCat] = useState<string | null>(() => scenarioById(params.get("preset"))?.category ?? "basics");
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  useEffect(() => {
    const ws = useWorkspace.getState();
    ws.setProfile(savedProfileId());
    const shared = params.get("d") && decodeShared(params.get("d")!);
    const preset = scenarioById(params.get("preset"));
    const saved = loadProgress().sandbox;
    ws.setResilience({ retries: true, dbFailover: false });
    if (shared) {
      applyScenario(shared);
      setCurrent(shared.name ? { title: shared.name, blurb: shared.description ?? "", tryThis: [] } : null);
    } else if (preset) {
      ws.load(preset.graph, preset.traffic);
      if (preset.resilience) ws.setResilience(preset.resilience);
      if (preset.incident) ws.setIncident(preset.incident);
      setCurrent(preset);
      if (preset.category) setOpenCat(preset.category);
    } else if (saved) ws.load(saved.graph, saved.traffic);
    else {
      const first = scenarioById("single")!;
      ws.load(first.graph, first.traffic);
      setCurrent(first);
    }
    return useWorkspace.subscribe((s, prev) => {
      if (s.graph !== prev.graph || s.traffic !== prev.traffic) updateProgress((p) => (p.sandbox = { graph: s.graph, traffic: s.traffic }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get("preset"), params.get("d")]);

  useChatSource("sandbox", {
    label: current ? `Sandbox · ${current.title}` : "Sandbox",
    build: () => ({ scenario: current ? { title: current.title, source: current.source, about: current.blurb, story: current.story, suggestedExercises: current.tryThis } : "a free canvas", savedScenarios: scenarios.map((s) => s.name) }),
  });

  const snapshot = (): Shared => {
    const { graph, traffic, incident, resilience } = useWorkspace.getState();
    return { graph, traffic, incident, resilience };
  };

  const saveScenario = () => {
    if (!name.trim()) return;
    const sc: Scenario = { id: `sc-${Date.now()}`, name: name.trim(), description: desc.trim(), savedAt: new Date().toISOString(), ...snapshot() };
    const next = [sc, ...scenarios];
    setScenarios(next);
    updateProgress((p) => (p.scenarios = next));
    setSaving(false);
    setName("");
    setDesc("");
    setCurrent({ title: sc.name, blurb: sc.description, tryThis: [] });
    useWorkspace.getState().notify(`Saved "${sc.name}" - it's in Your scenarios.`);
  };

  const overwrite = (sc: Scenario) => {
    const next = scenarios.map((s) => (s.id === sc.id ? { ...s, ...snapshot(), savedAt: new Date().toISOString() } : s));
    setScenarios(next);
    updateProgress((p) => (p.scenarios = next));
    useWorkspace.getState().notify(`Updated "${sc.name}".`);
  };

  const remove = (id: string) => {
    const next = scenarios.filter((s) => s.id !== id);
    setScenarios(next);
    updateProgress((p) => (p.scenarios = next));
  };

  const share = async (s: Shared = snapshot()) => {
    const d = compressToEncodedURIComponent(JSON.stringify(s));
    const url = `${location.origin}${location.pathname}#/sandbox?d=${d}`;
    try {
      await navigator.clipboard.writeText(url);
      useWorkspace.getState().notify("Link copied - anyone who opens it gets this exact design, traffic and incident.");
    } catch {
      prompt("Copy this link:", url);
    }
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(snapshot(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "scenario.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = async (f: File) => {
    try {
      const v = JSON.parse(await f.text()) as Shared;
      if (!v.graph?.nodes) throw new Error();
      applyScenario(v);
    } catch {
      useWorkspace.getState().notify("That file isn't a scenario export.");
    }
  };

  const left = presenter ? undefined : (
    <div className="side">
      <div className="side-head">
        <h2>Sandbox</h2>
        <p>Build anything, set the traffic, then break it. Everything saves in this browser.</p>
      </div>

      {current && (
        <section className="scenario-card">
          <span className="tag">{current.source ?? "Current scenario"}</span>
          <b>{current.title}</b>
          {current.blurb && <p>{current.blurb}</p>}
          {current.story && (
            <details className="scenario-story">
              <summary>The story behind it</summary>
              <Markdown>{current.story}</Markdown>
            </details>
          )}
          {current.lesson && (
            <Link className="scenario-lesson" to={`/lesson/${current.lesson}`}><BookOpen size={13} /> Full write-up: lesson {current.lesson}</Link>
          )}
          {current.tryThis.length > 0 && (
            <ol className="try-list">
              {current.tryThis.map((t, i) => <li key={t}><span className="step-num">{i + 1}</span><span>{t}</span></li>)}
            </ol>
          )}
        </section>
      )}

      <section className="side-section">
        <h4>Starting points <span className="muted small">{SCENARIOS.length}</span></h4>
        <label className="preset-search">
          <Search size={14} />
          <input placeholder="Search: Netflix, outage, webhooks, RAG..." value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search starting points" />
        </label>
        {PRESET_CATEGORIES.map((cat) => {
          const q = query.trim().toLowerCase();
          const list = SCENARIOS.filter((p) => p.category === cat.id && (!q || `${p.title} ${p.source ?? ""} ${p.blurb}`.toLowerCase().includes(q)));
          if (!list.length) return null;
          const open = !!q || openCat === cat.id;
          return (
            <div key={cat.id} className={`preset-group${open ? " open" : ""}`}>
              <button className="preset-group-head" onClick={() => setOpenCat(open && !q ? null : cat.id)} aria-expanded={open} title={cat.blurb}>
                <ChevronRight size={14} className="chev" />
                <span className="grow">{cat.title}</span>
                <span className="muted small">{list.length}</span>
              </button>
              {open && (
                <div className="preset-list">
                  {list.map((p) => (
                    <button key={p.id} className={`preset${current?.title === p.title ? " on" : ""}`} onClick={() => setParams({ preset: p.id })} title={p.blurb}>
                      <span className="preset-name">
                        <span>{p.title}</span>
                        {p.source && <span className="preset-source">{p.source}</span>}
                      </span>
                      <ChevronRight size={14} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section className="side-section">
        <h4>Your scenarios</h4>
        {scenarios.length === 0 && !saving && <p className="hint">Save a design with its traffic and incident to come back to it.</p>}
        {scenarios.length > 0 && (
          <ul className="my-scenarios">
            {scenarios.map((s) => (
              <li key={s.id}>
                <button className="linkish" onClick={() => { applyScenario(s); setCurrent({ title: s.name, blurb: s.description, tryThis: [] }); }} title={s.description || "Load this scenario"}>{s.name}</button>
                <span className="row-actions">
                  <button className="icon-btn sm" title="Save the current canvas over this scenario" aria-label="Overwrite" onClick={() => overwrite(s)}><RefreshCw size={14} /></button>
                  <button className="icon-btn sm" title="Copy a share link" aria-label="Copy share link" onClick={() => share(s)}><Link2 size={14} /></button>
                  <button className="icon-btn sm danger" title="Delete" aria-label="Delete" onClick={() => remove(s.id)}><Trash2 size={14} /></button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {saving ? (
          <div className="save-form">
            <input placeholder="Name, e.g. Black Friday checkout" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveScenario()} autoFocus />
            <textarea placeholder="What is it about? (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} />
            <div className="row gap">
              <button className="btn small primary" disabled={!name.trim()} onClick={saveScenario}>Save</button>
              <button className="btn small ghost" onClick={() => setSaving(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="btn small block" onClick={() => setSaving(true)}><Plus size={14} /> Save current design</button>
        )}
      </section>

      <details className="more">
        <summary>Share, capacities and recording</summary>
        <div className="more-body">
          <h4>Share</h4>
          <div className="row gap">
            <button className="btn small" onClick={() => share()}><Link2 size={14} /> Copy link</button>
            <button className="btn small" onClick={exportJson}><Download size={14} /> Export</button>
            <button className="btn small" onClick={() => fileRef.current?.click()}><Upload size={14} /> Import</button>
            <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
          </div>
          <h4>Machine capacities</h4>
          <div className="segmented small">
            <button className={profileId === "reference" ? "on" : ""} onClick={() => useWorkspace.getState().setProfile("reference", true)}>Reference</button>
            <button className={profileId === "measured" ? "on" : ""} disabled={!MEASURED} onClick={() => useWorkspace.getState().setProfile("measured", true)}>My machine</button>
          </div>
          <p className="hint">
            {MEASURED ? `Measured ${MEASURED.measuredAt.slice(0, 10)} on ${MEASURED.machine.cpu}.` : "Not measured yet."} <Link to="/machine">Benchmark →</Link>
          </p>
          <h4>Recording a video</h4>
          <p className="hint">Press <kbd>P</kbd> for presenter mode, pick an incident, press Run; <kbd>Space</kbd> pauses. Runs are deterministic, so every take matches.</p>
        </div>
      </details>
    </div>
  );

  return <Workspace left={left} leftLabel="scenarios" />;
}
