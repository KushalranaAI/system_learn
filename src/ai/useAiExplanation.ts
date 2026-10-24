import { useCallback, useEffect, useRef, useState } from "react";
import { askAi, type AiGuide } from "./client";
import { useAi, useAiActive } from "./settings";

/** off: no AI configured · idle: ready, waiting for the user to ask · loading · done · error */
export type AiStatus = "off" | "idle" | "loading" | "done" | "error";

const cache = new Map<string, AiGuide>();

/**
 * An AI explanation of `context` that runs only when the user asks (`explain()`), never on its own.
 * Results are cached by content, so asking again about an unchanged design is instant.
 * Returns status "off" when no provider is configured - callers then just show the built-in explanation.
 */
export function useAiExplanation(task: string, context: unknown, opts: { enabled?: boolean } = {}) {
  const active = useAiActive();
  const settings = useAi((s) => s.settings);
  const enabled = active && opts.enabled !== false && context != null;
  const key = enabled ? `${settings.provider}|${settings.model}|${settings.azureDeployment}|${task}|${JSON.stringify(context)}` : "";
  const [state, setState] = useState<{ status: AiStatus; data?: AiGuide; error?: string }>({ status: "off" });
  const keyRef = useRef(key);
  const ctrlRef = useRef<AbortController | null>(null);
  const latest = useRef({ settings, task, context });
  latest.current = { settings, task, context };
  keyRef.current = key;

  // The design changed (or AI was switched on/off): drop any request in flight and show the cached answer if there is one.
  useEffect(() => {
    ctrlRef.current?.abort();
    if (!enabled) return setState({ status: "off" });
    const cached = cache.get(key);
    setState(cached ? { status: "done", data: cached } : { status: "idle" });
    return () => ctrlRef.current?.abort();
  }, [key, enabled]);

  const run = useCallback(async () => {
    if (!keyRef.current) return;
    const runKey = keyRef.current;
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setState((s) => ({ status: "loading", data: s.data }));
    try {
      const { settings: st, task: t, context: c } = latest.current;
      const data = await askAi(st, t, c, ctrl.signal);
      cache.set(runKey, data);
      if (keyRef.current === runKey && !ctrl.signal.aborted) setState({ status: "done", data });
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setState({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  return {
    ...state,
    explain: run,
    regenerate: () => {
      cache.delete(keyRef.current);
      void run();
    },
  };
}
