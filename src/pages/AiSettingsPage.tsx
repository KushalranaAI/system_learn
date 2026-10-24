import { CircleCheck, CircleX, Lock, Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { testConnection } from "../ai/client";
import { DEFAULT_MODELS, isConfigured, providerLabel, useAi, type AiSettings, type Provider } from "../ai/settings";

const PROVIDERS: { id: Provider; title: string; blurb: string }[] = [
  { id: "none", title: "Built-in", blurb: "Rule-based explanations. Free, instant, works offline." },
  { id: "openai", title: "OpenAI", blurb: "Your OpenAI API key (sk-…)." },
  { id: "anthropic", title: "Anthropic (Claude)", blurb: "Your Anthropic API key (sk-ant-…)." },
  { id: "azure", title: "Azure OpenAI", blurb: "Your Azure OpenAI resource endpoint, deployment and key." },
];

/** Azure OpenAI blocks direct browser calls, so it needs this app's local relay - which static hosts don't have. */
function useRelayAvailable(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    fetch("./api/ai-proxy")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => setOk(!!j.available))
      .catch(() => setOk(false));
  }, []);
  return ok;
}

export function AiSettingsPage() {
  const relay = useRelayAvailable();
  const saved = useAi((s) => s.settings);
  const enabled = useAi((s) => s.enabled);
  const { save, clear, setEnabled } = useAi.getState();
  const [form, setForm] = useState<AiSettings>(saved);
  const [test, setTest] = useState<{ state: "idle" | "running" | "ok" | "fail"; msg?: string }>({ state: "idle" });
  const set = (patch: Partial<AiSettings>) => {
    setForm((f) => ({ ...f, ...patch }));
    setTest({ state: "idle" });
  };
  const choose = (provider: Provider) =>
    set({ provider, model: provider === "openai" || provider === "anthropic" ? (form.provider === provider ? form.model : DEFAULT_MODELS[provider]) : "" });

  const runTest = async () => {
    setTest({ state: "running" });
    try {
      const msg = await testConnection(form);
      setTest({ state: "ok", msg });
    } catch (e) {
      setTest({ state: "fail", msg: e instanceof Error ? e.message : String(e) });
    }
  };

  const active = isConfigured(saved) && enabled;
  return (
    <div className="page narrow">
      <header className="page-head">
        <p className="eyebrow">AI explanations</p>
        <h1>Let an AI explain your simulations.</h1>
        <p className="lead">The built-in explanations work offline. Add your own key to get "Explain with AI" buttons and a chat assistant that sees what is on your screen.</p>
      </header>

      <div className={`ai-status-card${active ? " on" : ""}`}>
        <span className="status-icon"><Sparkles size={18} /></span>
        <div className="grow">
          <b>{active ? `Using ${providerLabel(saved.provider)}` : "Using built-in explanations"}</b>
          <span className="muted small">{active ? saved.model || "default model" : "Free, instant, and works offline."}</span>
        </div>
        {isConfigured(saved) && (
          <label className="chip-toggle">
            <input type="checkbox" className="switch" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> {enabled ? "On" : "Paused"}
          </label>
        )}
      </div>

      <h2 className="section-title">Provider</h2>
      <div className="provider-grid">
        {PROVIDERS.filter((p) => p.id !== "azure" || relay || saved.provider === "azure").map((p) => (
          <button key={p.id} className={`provider${form.provider === p.id ? " on" : ""}`} onClick={() => choose(p.id)}>
            <b>{p.title}</b>
            <span className="small muted">{p.blurb}</span>
          </button>
        ))}
      </div>

      {form.provider !== "none" && (
        <div className="card ai-form">
          {form.provider === "azure" && (
            <>
              <label className="field">
                Endpoint
                <input placeholder="https://my-resource.openai.azure.com" value={form.azureEndpoint} onChange={(e) => set({ azureEndpoint: e.target.value })} />
              </label>
              <label className="field">
                Deployment name
                <input placeholder="gpt-4o-mini" value={form.azureDeployment} onChange={(e) => set({ azureDeployment: e.target.value })} />
              </label>
              <label className="field">
                API version
                <input value={form.azureApiVersion} onChange={(e) => set({ azureApiVersion: e.target.value })} />
              </label>
            </>
          )}
          <label className="field">
            API key
            <input type="password" autoComplete="off" placeholder={form.provider === "anthropic" ? "sk-ant-…" : form.provider === "openai" ? "sk-…" : "Azure key"} value={form.apiKey} onChange={(e) => set({ apiKey: e.target.value })} />
          </label>
          {form.provider !== "azure" && (
            <label className="field">
              Model
              <input value={form.model} onChange={(e) => set({ model: e.target.value })} />
              <span className="muted small">Default: {DEFAULT_MODELS[form.provider]}. Any chat model your key can use works.</span>
            </label>
          )}
          <label className="toggle">
            <input type="checkbox" checked={form.remember} onChange={(e) => set({ remember: e.target.checked })} /> Remember this key in this browser
          </label>
          {form.remember ? (
            <p className="warn-note">
              <TriangleAlert size={15} />
              <span>
                <b>Not the safe option.</b> The key stays on this device until you clear it, and anyone who uses this browser, or any browser extension or script running on this site, could read it.
                Never use this on a shared or public computer. Use a key with a low spending limit, and delete it from your provider if you lose the device.
              </span>
            </p>
          ) : (
            <p className="hint">Safer default: the key is kept only until you close this tab.</p>
          )}
          <div className="row gap">
            <button className="btn" disabled={!isConfigured(form) || test.state === "running"} onClick={runTest}>
              {test.state === "running" ? "Testing…" : "Test connection"}
            </button>
            <button className="btn primary" disabled={!isConfigured(form)} onClick={() => { save(form); setEnabled(true); }}>Save and use AI</button>
            <button className="btn ghost danger" onClick={() => { clear(); setForm({ ...form, apiKey: "" }); }}>Clear saved key</button>
          </div>
          {test.state === "ok" && <p className="good small row gap"><CircleCheck size={15} /> Connected - the AI answered: "{test.msg}"</p>}
          {test.state === "fail" && <p className="bad small row gap"><CircleX size={15} /> {test.msg}</p>}
        </div>
      )}
      {form.provider === "none" && isConfigured(saved) && (
        <div className="row gap">
          <button className="btn" onClick={() => { clear(); }}>Switch to built-in and forget the key</button>
        </div>
      )}
      <details className="more card privacy" open={!isConfigured(saved)}>
        <summary><Lock size={14} /> Your key stays on your machine</summary>
        <div className="more-body">
        <ul className="small privacy-list">
          <li>It's stored only in this browser - just this tab, or this browser after restarts if you tick "Remember".</li>
          <li>It's sent only to the provider you choose: directly from your browser to OpenAI or Anthropic{relay ? ", and to Azure through this app's own local server running on your computer (Azure blocks direct browser calls)" : ""}.</li>
          <li>It's never put in share links, scenario exports, progress files or the repository. Remove it any time with "Clear saved key".</li>
          <li>Each explanation is one API call billed to your account. Nothing is sent until you click "Explain with AI" or send a chat message. Answers to unchanged designs are cached.</li>
        </ul>
        </div>
      </details>
    </div>
  );
}
