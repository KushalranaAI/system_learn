import { ArrowRight, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";
import type { AiGuide } from "./client";
import { providerLabel, useAi } from "./settings";
import type { AiStatus } from "./useAiExplanation";

/** Renders an AI explanation, with clear loading and error states (callers keep the built-in guide as fallback). */
export function AiGuideCard({ status, data, error, regenerate, compact }: { status: AiStatus; data?: AiGuide; error?: string; regenerate: () => void; compact?: boolean }) {
  const provider = useAi((s) => s.settings.provider);
  if (status === "off") return null;
  const busy = status === "waiting" || status === "loading";
  return (
    <div className={`ai-card${compact ? " compact" : ""}`}>
      <div className="ai-head">
        <span className="ai-badge"><Sparkles size={12} /> AI · {providerLabel(provider)}</span>
        {busy && <span className="ai-status"><span className="pulse" /> {status === "waiting" ? "waiting for you to pause…" : "writing…"}</span>}
        {status === "done" && <button className="icon-btn sm" onClick={regenerate} title="Ask again" aria-label="Ask again"><RefreshCw size={13} /></button>}
      </div>
      {status === "error" && (
        <p className="ai-error">
          <TriangleAlert size={14} /> <span>AI explanation failed: {error?.replace(/[.\s]+$/, "")}. Showing the built-in explanation instead. <Link to="/ai">Settings</Link> · <button className="linkish" onClick={regenerate}>retry</button></span>
        </p>
      )}
      {data && (
        <div className={busy ? "ai-stale" : ""}>
          <p className="headline">{data.headline}</p>
          {data.whatHappened.length > 0 && <ul>{data.whatHappened.map((w) => <li key={w}>{w}</li>)}</ul>}
          {data.problems.map((p) => (
            <div key={p.problem} className="advice warn open">
              <div className="advice-head static"><TriangleAlert size={16} className="advice-icon" /><span className="grow">{p.problem}</span></div>
              <div className="advice-body">
                <p><span className="tag">Why</span>{p.why}</p>
                <p><span className="tag">Try</span>{p.fix}</p>
                <p><span className="tag">Trade-off</span>{p.tradeoff}</p>
              </div>
            </div>
          ))}
          {data.nextStep && <p className="ai-next"><ArrowRight size={14} /> <span>{data.nextStep}</span></p>}
        </div>
      )}
    </div>
  );
}
