import { CircleCheck, CircleX, FileKey2, KeyRound, Lock, LockOpen, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { testConnection } from "../ai/client";
import { DEFAULT_MODELS, isConfigured, isLocalHost, providerLabel, useAi, type AiSettings, type Provider } from "../ai/settings";
import type { Protection } from "../ai/vault";

const PROVIDERS: { id: Provider; title: string; blurb: string }[] = [
  { id: "none", title: "Built-in", blurb: "Rule-based explanations. Free, instant, works offline." },
  { id: "openai", title: "OpenAI", blurb: "Your OpenAI API key (sk-…)." },
  { id: "anthropic", title: "Anthropic (Claude)", blurb: "Your Anthropic API key (sk-ant-…)." },
  { id: "azure", title: "Azure OpenAI", blurb: "Your Azure OpenAI resource endpoint, deployment and key." },
];

const MIN_PASSPHRASE = 8;

/** Azure OpenAI blocks direct browser calls, so it needs this app's local relay - which static hosts don't have. */
function useRelayAvailable(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (!isLocalHost()) return;
    fetch("./api/ai-proxy")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => setOk(!!j.available))
      .catch(() => setOk(false));
  }, []);
  return ok;
}

function UnlockCard() {
  const { unlock, clear } = useAi.getState();
  const [pass, setPass] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!pass || busy) return;
    setBusy(true);
    setErr(await unlock(pass));
    setBusy(false);
  };
  return (
    <div className="card unlock-card">
      <div className="row gap nowrap">
        <span className="status-icon"><Lock size={18} /></span>
        <div className="grow">
          <b>Your saved key is locked</b>
          <span className="muted small" style={{ display: "block" }}>It's encrypted with your passphrase. Enter it once and it stays unlocked until you close the browser.</span>
        </div>
      </div>
      <form className="row gap nowrap" onSubmit={(e) => (e.preventDefault(), void submit())}>
        <input className="grow" type="password" autoComplete="current-password" placeholder="Passphrase" value={pass} onChange={(e) => (setPass(e.target.value), setErr(null))} autoFocus />
        <button className="btn primary" type="submit" disabled={!pass || busy}>{busy ? "Unlocking…" : "Unlock"}</button>
      </form>
      {err && <p className="bad small row gap"><CircleX size={15} /> {err}</p>}
      <button className="linkish small" onClick={() => void clear()}>Forgot it? Remove the saved key and start over</button>
    </div>
  );
}

export function AiSettingsPage() {
  const relay = useRelayAvailable();
  const saved = useAi((s) => s.settings);
  const status = useAi((s) => s.status);
  const savedProtection = useAi((s) => s.protection);
  const loadError = useAi((s) => s.loadError);
  const canPersist = useAi((s) => s.canPersist);
  const serverKeys = useAi((s) => s.serverKeys);
  const enabled = useAi((s) => s.enabled);
  const { save, clear, setEnabled, lock, useServerKey } = useAi.getState();
  const [form, setForm] = useState<AiSettings>(saved);
  const [protection, setProtection] = useState<Protection>(savedProtection);
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<{ state: "idle" | "running" | "ok" | "fail"; msg?: string }>({ state: "idle" });

  // Settings arrive asynchronously at startup (saved key, then any .env key) and change on save/clear: keep the form in step.
  useEffect(() => {
    if (status === "ready") {
      setForm(saved);
      setProtection(savedProtection);
    }
  }, [status, saved]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<AiSettings>) => {
    // typing a key (or switching provider) by hand means "use this key", not the one from .env
    setForm((f) => ({ ...f, ...patch, ...("apiKey" in patch || "provider" in patch ? { viaServer: false } : {}) }));
    setTest({ state: "idle" });
    setMsg(null);
  };
  const choose = (provider: Provider) =>
    set({ provider, model: provider === "openai" || provider === "anthropic" ? (form.provider === provider ? form.model : DEFAULT_MODELS[provider]) : "" });

  const runTest = async () => {
    setTest({ state: "running" });
    try {
      setTest({ state: "ok", msg: await testConnection(form) });
    } catch (e) {
      setTest({ state: "fail", msg: e instanceof Error ? e.message : String(e) });
    }
  };

  // A passphrase is needed when switching to passphrase mode, or changing it. Re-saving while unlocked reuses the session.
  const needsNewPass = protection === "passphrase" && (savedProtection !== "passphrase" || pass.length > 0 || pass2.length > 0);
  const passProblem = !needsNewPass ? null : pass.length < MIN_PASSPHRASE ? `Use at least ${MIN_PASSPHRASE} characters.` : pass !== pass2 ? "The two passphrases don't match." : null;

  const onSave = async () => {
    setSaving(true);
    const r = await save({ ...form, viaServer: form.viaServer && !form.apiKey.trim() }, { protection, passphrase: needsNewPass ? pass : undefined });
    setSaving(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    setEnabled(true);
    setPass("");
    setPass2("");
    setMsg({
      ok: true,
      text: !r.persisted
        ? "In use now, but this browser can't encrypt, so it was not saved. (Encryption needs https or localhost.)"
        : form.remember
          ? "Saved and encrypted. It will load automatically next time, with nothing to type."
          : "Saved and encrypted for this tab only.",
    });
  };

  const active = isConfigured(saved) && enabled && status === "ready";
  return (
    <div className="page narrow">
      <header className="page-head">
        <p className="eyebrow">AI explanations</p>
        <h1>Let an AI explain your simulations.</h1>
        <p className="lead">The built-in explanations work offline. Add your own key to get "Explain with AI" buttons and a chat assistant that sees what is on your screen.</p>
      </header>

      {status === "locked" && <UnlockCard />}
      {loadError && <p className="warn-note"><TriangleAlert size={15} /><span>{loadError}</span></p>}

      <div className={`ai-status-card${active ? " on" : ""}`}>
        <span className="status-icon"><Sparkles size={18} /></span>
        <div className="grow">
          <b>{status === "loading" ? "Loading your saved key…" : active ? `Using ${providerLabel(saved.provider)}` : status === "locked" ? "Locked" : "Using built-in explanations"}</b>
          <span className="muted small">
            {active
              ? saved.viaServer
                ? `${saved.model || "default model"} · key from your .env file, kept on this computer and never sent to the browser`
                : `${saved.model || "default model"} · ${savedProtection === "passphrase" ? "encrypted with your passphrase" : "encrypted on this device"}${saved.remember ? "" : " · this tab only"}`
              : status === "locked"
                ? "Enter your passphrase above to use AI."
                : "Free, instant, and works offline."}
          </span>
        </div>
        {isConfigured(saved) && status === "ready" && (
          <label className="chip-toggle">
            <input type="checkbox" className="switch" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> {enabled ? "On" : "Paused"}
          </label>
        )}
        {savedProtection === "passphrase" && status === "ready" && isConfigured(saved) && (
          <button className="btn small" onClick={lock} title="Forget the passphrase for now; you'll need it to use AI again"><Lock size={14} /> Lock</button>
        )}
      </div>

      {serverKeys && (serverKeys.openai || serverKeys.anthropic || serverKeys.azure) && status !== "locked" && (
        <div className="card env-card">
          <div className="row gap nowrap">
            <span className="status-icon"><FileKey2 size={18} /></span>
            <div className="grow">
              <b>Keys found in your .env file</b>
              <span className="muted small" style={{ display: "block" }}>
                They stay on this computer's server, which adds them to requests. The browser never sees them and nothing is stored in it.
              </span>
            </div>
          </div>
          <div className="row gap">
            {(["openai", "anthropic", "azure"] as const).filter((p) => serverKeys[p]).map((p) => {
              const on = !!saved.viaServer && saved.provider === p && active;
              return (
                <button key={p} className={`btn ${on ? "primary" : ""}`} onClick={() => void useServerKey(p)}>
                  {on ? <CircleCheck size={15} /> : <FileKey2 size={15} />} {on ? "Using" : "Use"} {providerLabel(p)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <h2 className="section-title">{serverKeys ? "Or use a key from your browser" : "Provider"}</h2>
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
          {form.viaServer && (
            <p className="hint good"><FileKey2 size={14} /> <span>Using the key from your <code>.env</code> file. Type a key below only if you want to use a different one in the browser instead.</span></p>
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

          <h4 className="settings-sub">How to keep it</h4>
          <label className="setting switch-row">
            <span className="setting-text">
              <span className="setting-label">Remember it in this browser</span>
              <span className="help">Saved encrypted, so it's already there when you reopen the app. Remove it any time below. Turn this off to keep it for this tab only.</span>
            </span>
            <input type="checkbox" className="switch" checked={form.remember} onChange={(e) => set({ remember: e.target.checked })} />
          </label>

          <div className="protect">
            <span className="setting-label"><ShieldCheck size={15} /> Protect it with</span>
            <div className="segmented">
              <button className={protection === "device" ? "on" : ""} onClick={() => (setProtection("device"), setMsg(null))}><LockOpen size={13} /> This device</button>
              <button className={protection === "passphrase" ? "on" : ""} onClick={() => (setProtection("passphrase"), setMsg(null))}><KeyRound size={13} /> A passphrase</button>
            </div>
            {protection === "device" ? (
              <p className="hint">
                <span><b>No password to type.</b> Encrypted with AES-256, and the key that unlocks it is held by your browser and can't be copied out, so a copied or dumped
                browser storage is unreadable. Best for your own computer. On a shared computer, use a passphrase.</span>
              </p>
            ) : (
              <>
                <p className="hint">
                  <span><b>Strongest.</b> Encrypted with AES-256 using a key made from your passphrase, which is never saved anywhere. Nobody can decrypt it without the passphrase,
                  including this app. You type it once each time you open the browser.</span>
                </p>
                {savedProtection === "passphrase" && !needsNewPass && (
                  <p className="hint good"><CircleCheck size={14} /> <span>Your passphrase is set and unlocked. Type a new one below only if you want to change it.</span></p>
                )}
                <div className="pass-grid">
                  <input type="password" autoComplete="new-password" placeholder={savedProtection === "passphrase" ? "New passphrase (optional)" : "Passphrase"} value={pass} onChange={(e) => (setPass(e.target.value), setMsg(null))} />
                  <input type="password" autoComplete="new-password" placeholder="Repeat it" value={pass2} onChange={(e) => (setPass2(e.target.value), setMsg(null))} />
                </div>
                {passProblem && (pass.length > 0 || pass2.length > 0) && <p className="bad small">{passProblem}</p>}
                <p className="hint warm"><TriangleAlert size={14} /> <span>If you forget it, the saved key can't be recovered. You'd just add the key again.</span></p>
              </>
            )}
          </div>

          {!canPersist && <p className="warn-note"><TriangleAlert size={15} /><span>This browser can't encrypt right now (it needs https or localhost), so the key won't be saved between visits.</span></p>}

          <div className="row gap">
            <button className="btn" disabled={!isConfigured(form) || test.state === "running"} onClick={runTest}>
              {test.state === "running" ? "Testing…" : "Test connection"}
            </button>
            <button className="btn primary" disabled={!isConfigured(form) || saving || !!passProblem || (protection === "passphrase" && needsNewPass && !pass)} onClick={() => void onSave()}>
              {saving ? "Encrypting…" : "Save and use AI"}
            </button>
            <button className="btn ghost danger" onClick={() => { void clear(); setForm({ ...form, apiKey: "" }); setMsg({ ok: true, text: "Removed. The saved key and its encryption key are deleted from this browser." }); }}>Remove saved key</button>
          </div>
          {msg && <p className={`${msg.ok ? "good" : "bad"} small row gap`}>{msg.ok ? <CircleCheck size={15} /> : <CircleX size={15} />} {msg.text}</p>}
          {test.state === "ok" && <p className="good small row gap"><CircleCheck size={15} /> Connected - the AI answered: "{test.msg}"</p>}
          {test.state === "fail" && <p className="bad small row gap"><CircleX size={15} /> {test.msg}</p>}
        </div>
      )}
      {form.provider === "none" && isConfigured(saved) && (
        <div className="row gap">
          <button className="btn" onClick={() => void clear()}>Switch to built-in and forget the key</button>
        </div>
      )}
      <details className="more card privacy" open={!isConfigured(saved) && status === "ready"}>
        <summary><Lock size={14} /> How your key is protected, and what that can't do</summary>
        <div className="more-body">
          <ul className="small privacy-list">
            <li>Your key, and for Azure the endpoint and deployment, are saved <b>encrypted (AES-256-GCM)</b> in this browser. Nothing readable is stored, and the saved data is tamper-evident.</li>
            <li>Running locally, you can keep the key in a <code>.env</code> file instead: it never reaches the browser at all. Otherwise nothing is stored on any server. It's sent only to the provider you choose{relay ? ", and to Azure through this app's own local server on your computer" : ""}, and never put in share links, exports or the repository.</li>
            <li>What encryption protects against: someone copying your browser's storage or profile files, or another website reading it. Only this site can use the saved key.</li>
            <li>What it can't protect against: a browser extension or malicious code that runs <i>inside this page</i> while the key is unlocked can ask the browser to use it. That's why this site loads no third-party scripts and restricts what the page may run or connect to. Use a passphrase on shared computers, and give the key a low spending limit.</li>
            <li>Each explanation is one API call billed to your account. Nothing is sent until you click "Explain with AI" or send a chat message.</li>
          </ul>
        </div>
      </details>
    </div>
  );
}
