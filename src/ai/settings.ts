import { create } from "zustand";

export type Provider = "none" | "openai" | "anthropic" | "azure";

export interface AiSettings {
  provider: Provider;
  apiKey: string;
  model: string;
  /** Azure OpenAI only */
  azureEndpoint: string;
  azureDeployment: string;
  azureApiVersion: string;
  /** keep the key after the browser closes (localStorage) instead of only this tab (sessionStorage) */
  remember: boolean;
}

export const DEFAULT_MODELS: Record<Exclude<Provider, "none" | "azure">, string> = {
  anthropic: "claude-opus-5-5",
  openai: "gpt-4o-mini",
};

const EMPTY: AiSettings = {
  provider: "none",
  apiKey: "",
  model: "",
  azureEndpoint: "",
  azureDeployment: "",
  azureApiVersion: "2024-10-21",
  remember: false,
};

const KEY = "system-learn:ai";

function read(): AiSettings {
  try {
    const raw = localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY);
    if (raw) return { ...EMPTY, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return EMPTY;
}

function write(s: AiSettings) {
  try {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(KEY);
    if (s.provider === "none") return;
    (s.remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

export function isConfigured(s: AiSettings): boolean {
  if (s.provider === "none" || !s.apiKey.trim()) return false;
  if (s.provider === "azure") return !!s.azureEndpoint.trim() && !!s.azureDeployment.trim();
  return true;
}

export const providerLabel = (p: Provider) =>
  p === "openai" ? "OpenAI" : p === "anthropic" ? "Anthropic (Claude)" : p === "azure" ? "Azure OpenAI" : "Built-in (no AI)";

interface AiState {
  settings: AiSettings;
  /** use AI explanations when configured (can be paused without deleting the key) */
  enabled: boolean;
  save: (s: AiSettings) => void;
  clear: () => void;
  setEnabled: (v: boolean) => void;
}

export const useAi = create<AiState>((set) => ({
  settings: read(),
  enabled: true,
  save: (s) => {
    write(s);
    set({ settings: s });
  },
  clear: () => {
    write(EMPTY);
    set({ settings: EMPTY });
  },
  setEnabled: (enabled) => set({ enabled }),
}));

/** True when explanations should come from the AI. */
export const useAiActive = () => useAi((s) => s.enabled && isConfigured(s.settings));
