import { create } from "zustand";
import { Vault, VaultError, cryptoAvailable, isEnvelope, type Envelope, type Protection } from "./vault";

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
  // saved by default, so the key is there next time; it is encrypted either way
  remember: true,
};

const KEY = "system-learn:ai";
const vault = new Vault();

/** loading: reading storage · ready: settings available · locked: encrypted with a passphrase that isn't entered yet */
export type AiStatus = "loading" | "ready" | "locked";

function stored(): { raw: string; persistent: boolean } | null {
  try {
    const local = localStorage.getItem(KEY);
    if (local) return { raw: local, persistent: true };
    const session = sessionStorage.getItem(KEY);
    if (session) return { raw: session, persistent: false };
  } catch {
    /* storage unavailable */
  }
  return null;
}

function removeStored() {
  try {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

function writeStored(env: Envelope, remember: boolean) {
  try {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(KEY);
    (remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(env));
  } catch {
    /* storage full or blocked: the key just won't persist */
  }
}

export function isConfigured(s: AiSettings): boolean {
  if (s.provider === "none" || !s.apiKey.trim()) return false;
  if (s.provider === "azure") return !!s.azureEndpoint.trim() && !!s.azureDeployment.trim();
  return true;
}

export const providerLabel = (p: Provider) =>
  p === "openai" ? "OpenAI" : p === "anthropic" ? "Anthropic (Claude)" : p === "azure" ? "Azure OpenAI" : "Built-in (no AI)";

export interface SaveOptions {
  protection: Protection;
  /** required the first time a passphrase is set (or changed); afterwards the unlocked session is reused */
  passphrase?: string;
}

export type SaveResult = { ok: true; persisted: boolean } | { ok: false; error: string };

interface AiState {
  settings: AiSettings;
  /** use AI explanations when configured (can be paused without deleting the key) */
  enabled: boolean;
  status: AiStatus;
  protection: Protection;
  /** why the saved key couldn't be loaded, if it couldn't (shown on the AI page) */
  loadError: string | null;
  /** false when the browser can't encrypt, so nothing was written to storage */
  canPersist: boolean;
  init: () => Promise<void>;
  save: (s: AiSettings, opts: SaveOptions) => Promise<SaveResult>;
  unlock: (passphrase: string) => Promise<string | null>;
  lock: () => void;
  clear: () => Promise<void>;
  setEnabled: (v: boolean) => void;
}

let pending: Envelope | null = null;
let initStarted = false;

export const useAi = create<AiState>((set, get) => ({
  settings: EMPTY,
  enabled: true,
  status: "loading",
  protection: "device",
  loadError: null,
  canPersist: cryptoAvailable(),

  init: async () => {
    if (initStarted) return;
    initStarted = true;
    const found = stored();
    if (!found) return set({ status: "ready" });
    let parsed: unknown;
    try {
      parsed = JSON.parse(found.raw);
    } catch {
      removeStored();
      return set({ status: "ready" });
    }
    // Keys saved by an older version were plain text: read them once, then rewrite them encrypted.
    if (!isEnvelope(parsed)) {
      const legacy = { ...EMPTY, ...(parsed as Partial<AiSettings>), remember: found.persistent };
      set({ settings: legacy, status: "ready" });
      if (cryptoAvailable() && isConfigured(legacy)) {
        try {
          writeStored(await vault.seal(JSON.stringify(legacy), "device"), found.persistent);
        } catch {
          /* leave it as it was; the next save will try again */
        }
      } else removeStored();
      return;
    }
    if (parsed.mode === "passphrase" && !vault.isUnlocked(parsed)) {
      pending = parsed;
      return set({ status: "locked", protection: "passphrase" });
    }
    try {
      const settings = { ...EMPTY, ...(JSON.parse(await vault.open(parsed)) as Partial<AiSettings>), remember: found.persistent };
      set({ settings, status: "ready", protection: parsed.mode });
    } catch (e) {
      // The key can't be recovered (e.g. site data was partly cleared). Say so, and start clean rather than showing garbage.
      removeStored();
      set({ status: "ready", loadError: e instanceof VaultError ? e.message : "The saved key couldn't be read. Please add it again." });
    }
  },

  save: async (s, { protection, passphrase }) => {
    if (s.provider === "none") {
      await get().clear();
      return { ok: true, persisted: false };
    }
    // Use the new values right away, whether or not they can be written down.
    set({ settings: s, protection, status: "ready", loadError: null });
    if (!cryptoAvailable()) {
      set({ canPersist: false });
      return { ok: true, persisted: false };
    }
    try {
      const env = await vault.seal(JSON.stringify(s), protection, passphrase);
      writeStored(env, s.remember);
      set({ canPersist: true });
      return { ok: true, persisted: true };
    } catch (e) {
      return { ok: false, error: e instanceof VaultError ? e.message : "Couldn't encrypt and save the key." };
    }
  },

  unlock: async (passphrase) => {
    const env = pending;
    if (!env) return null;
    try {
      const found = stored();
      const settings = { ...EMPTY, ...(JSON.parse(await vault.open(env, passphrase)) as Partial<AiSettings>), remember: found?.persistent ?? true };
      pending = null;
      set({ settings, status: "ready", protection: "passphrase", loadError: null });
      return null;
    } catch (e) {
      return e instanceof VaultError ? e.message : "Couldn't unlock the saved key.";
    }
  },

  lock: () => {
    const found = stored();
    let env: Envelope | null = null;
    try {
      const p = found && JSON.parse(found.raw);
      if (isEnvelope(p) && p.mode === "passphrase") env = p;
    } catch {
      /* ignore */
    }
    if (!env) return;
    vault.lock();
    pending = env;
    set({ settings: EMPTY, status: "locked" });
  },

  clear: async () => {
    removeStored();
    pending = null;
    await vault.destroy();
    set({ settings: EMPTY, status: "ready", protection: "device", loadError: null });
  },

  setEnabled: (enabled) => set({ enabled }),
}));

void useAi.getState().init();

/** True when explanations should come from the AI. */
export const useAiActive = () => useAi((s) => s.enabled && s.status === "ready" && isConfigured(s.settings));
