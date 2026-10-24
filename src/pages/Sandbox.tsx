import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import { ChevronRight, Download, Link2, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Graph, Incident, Resilience, Traffic } from "../engine";
import { PRESETS } from "../presets";
import { loadProgress, updateProgress, type Scenario } from "../progress";
import { MEASURED, savedProfileId } from "../state/profile";
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
  const [current, setCurrent] = useState<{ title: string; blurb: string; tryThis: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  useEffect(() => {
    const ws = useWorkspace.getState();
    ws.setProfile(savedProfileId());
    const shared = params.get("d") && decodeShared(params.get("d")!);
    const preset = PRESETS.find((p) => p.id === params.get("preset"));
    const saved = loadProgress().sandbox;
    ws.setResilience({ retries: true, dbFailover: false });
    if (shared) {
      applyScenario(shared);
      setCurrent(shared.name ? { title: shared.name, blurb: shared.description ?? "", tryThis: [] } : null);
    } else if (preset) {
      ws.load(preset.graph, preset.traffic);
      setCurrent(preset);
    } else if (saved) ws.load(saved.graph, saved.traffic);
    else {
      ws.load(PRESETS[1].graph, PRESETS[1].traffic);
      setCurrent(PRESETS[1]);
    }
    return useWorkspace.subscribe((s, prev) => {
      if (s.graph !== prev.graph || s.traffic !== prev.traffic) updateProgress((p) => (p.sandbox = { graph: s.graph, traffic: s.traffic }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get("preset"), params.get("d")]);

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
          <span className="tag">Current scenario</span>
          <b>{current.title}</b>
          {current.blurb && <p>{current.blurb}</p>}
          {current.tryThis.length > 0 && (
            <ol className="try-list">
              {current.tryThis.map((t, i) => <li key={t}><span className="step-num">{i + 1}</span><span>{t}</span></li>)}
            </ol>
          )}
        </section>
      )}

      <section className="side-section">
        <h4>Starting points</h4>
        <div className="preset-list">
          {PRESETS.map((p) => (
            <button key={p.id} className={`preset${current?.title === p.title ? " on" : ""}`} onClick={() => setParams({ preset: p.id })} title={p.blurb}>
              <span>{p.title}</span>
              <ChevronRight size={14} />
            </button>
          ))}
        </div>
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
