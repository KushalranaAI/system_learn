import { useEffect, useRef, useState } from "react";
import { askAi, type AiGuide } from "./client";
import { useAi, useAiActive } from "./settings";

export type AiStatus = "off" | "waiting" | "loading" | "done" | "error";

const cache = new Map<string, AiGuide>();

/**
 * Ask the AI to explain `context` once it stops changing (debounced), with caching by content.
 * Returns status "off" when no provider is configured - callers then show the built-in explanation.
 */
export function useAiExplanation(task: string, context: unknown, opts: { enabled?: boolean; debounceMs?: number } = {}) {
  const active = useAiActive();
  const settings = useAi((s) => s.settings);
  const enabled = active && opts.enabled !== false && context != null;
  const key = enabled ? `${settings.provider}|${settings.model}|${settings.azureDeployment}|${task}|${JSON.stringify(context)}` : "";
  const [state, setState] = useState<{ status: AiStatus; data?: AiGuide; error?: string }>({ status: "off" });
  const [nonce, setNonce] = useState(0);
  const last = useRef("");

  useEffect(() => {
    if (!enabled) {
      setState({ status: "off" });
      return;
    }
    const cached = cache.get(key);
    if (cached) {
      setState({ status: "done", data: cached });
      return;
    }
    setState((s) => ({ status: "waiting", data: s.data }));
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      last.current = key;
      setState((s) => ({ status: "loading", data: s.data }));
      try {
        const data = await askAi(settings, task, context, ctrl.signal);
        cache.set(key, data);
        if (last.current === key) setState({ status: "done", data });
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setState({ status: "error", error: e instanceof Error ? e.message : String(e) });
      }
    }, opts.debounceMs ?? 1200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);

  return {
    ...state,
    regenerate: () => {
      cache.delete(key);
      setNonce((n) => n + 1);
    },
  };
}
