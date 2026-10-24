import { useEffect, useRef } from "react";
import { create } from "zustand";
import { chatAi, type ChatMsg } from "../ai/chat";
import { isConfigured, useAi } from "../ai/settings";

/** What a screen tells the chat about itself. `build` runs only when a question is sent, so it can be as detailed as it likes. */
export interface ChatSource {
  /** short label shown to the learner, e.g. "Sandbox · 5 components" */
  label: string;
  /** starter questions that make sense on this screen (cheap to compute: read on every render of the chat) */
  suggestions?: string[];
  build: () => unknown;
}

const sources = new Map<string, ChatSource>();
const listeners = new Set<() => void>();

/** Called by a screen while it is mounted. The latest closure is always used, so `build` can read live state. */
export function useChatSource(key: string, source: ChatSource | null) {
  const ref = useRef(source);
  ref.current = source;
  const present = source !== null;
  useEffect(() => {
    if (!present) return;
    sources.set(key, { get label() { return ref.current?.label ?? ""; }, get suggestions() { return ref.current?.suggestions; }, build: () => ref.current?.build() });
    listeners.forEach((l) => l());
    return () => {
      sources.delete(key);
      listeners.forEach((l) => l());
    };
  }, [key, present]);
}

export const chatSources = () => [...sources.values()].filter((s) => s.label);
export const onSourcesChange = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

/** Everything the screen can say about itself, keyed by source, plus where the learner is in the app. */
export function collectContext(route: string): Record<string, unknown> {
  const out: Record<string, unknown> = { screen: route };
  for (const [key, src] of sources) {
    try {
      out[key] = src.build();
    } catch {
      out[key] = "(unavailable)";
    }
  }
  return out;
}

interface ChatState {
  open: boolean;
  busy: boolean;
  messages: (ChatMsg & { error?: boolean })[];
  setOpen: (v: boolean) => void;
  send: (text: string, route: string) => Promise<void>;
  stop: () => void;
  clear: () => void;
}

let ctrl: AbortController | null = null;
const HISTORY_LIMIT = 12;

export const useChat = create<ChatState>((set, get) => ({
  open: false,
  busy: false,
  messages: [],
  setOpen: (open) => set({ open }),
  stop: () => ctrl?.abort(),
  clear: () => {
    ctrl?.abort();
    set({ messages: [], busy: false });
  },
  send: async (text, route) => {
    const q = text.trim();
    const settings = useAi.getState().settings;
    if (!q || get().busy || !isConfigured(settings)) return;
    const history = [...get().messages.filter((m) => !m.error), { role: "user" as const, content: q }].slice(-HISTORY_LIMIT);
    set((s) => ({ busy: true, messages: [...s.messages, { role: "user", content: q }, { role: "assistant", content: "" }] }));
    const patchLast = (fn: (m: ChatState["messages"][number]) => ChatState["messages"][number]) =>
      set((s) => ({ messages: s.messages.map((m, i) => (i === s.messages.length - 1 ? fn(m) : m)) }));
    ctrl = new AbortController();
    const mine = ctrl;
    try {
      await chatAi(settings, history, collectContext(route), (d) => patchLast((m) => ({ ...m, content: m.content + d })), mine.signal);
    } catch (e) {
      if (mine.signal.aborted) patchLast((m) => (m.content ? m : { ...m, content: "(stopped)" }));
      else patchLast((m) => ({ ...m, error: true, content: e instanceof Error ? e.message : String(e) }));
    } finally {
      if (ctrl === mine) set({ busy: false });
    }
  },
}));
