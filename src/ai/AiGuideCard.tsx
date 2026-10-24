import { ArrowRight, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";
import type { AiGuide } from "./client";
import { providerLabel, useAi } from "./settings";
import type { AiStatus } from "./useAiExplanation";

interface Props {
  status: AiStatus;
  data?: AiGuide;
  error?: string;
  explain: () => void;
  regenerate: () => void;
  compact?: boolean;
}

/** An AI explanation the user asks for on demand. Callers keep the built-in explanation visible until this has an answer. */
export function AiGuideCard({ status, data, error, explain, regenerate, compact }: Props) {
  const provider = useAi((s) => s.settings.provider);
  if (status === "off") return null;
  const busy = status === "loading";

  if (status === "idle")
    return (
      <div className="ai-ask">
        <button className="btn small" onClick={explain}><Sparkles size={14} /> Explain with AI</button>
        <span className="hint">Optional. Takes a few seconds and uses your {providerLabel(provider)} key.</span>
      </div>
    );

  return (
    <div className={`ai-card${compact ? " compact" : ""}`}>
      <div className="ai-head">
        <span className="ai-badge"><Sparkles size={12} /> AI · {providerLabel(provider)}</span>
        {busy && <span className="ai-status"><span className="pulse" /> writing…</span>}
        {status === "done" && <button className="icon-btn sm" onClick={regenerate} title="Ask again" aria-label="Ask again"><RefreshCw size={13} /></button>}
      </div>
      {status === "error" && (
        <p className="ai-error">
          <TriangleAlert size={14} />
          <span>
            AI explanation failed: {error?.replace(/[.\s]+$/, "")}. The built-in explanation is shown instead. <Link to="/ai">Settings</Link> · <button className="linkish" onClick={explain}>try again</button>
          </span>
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
