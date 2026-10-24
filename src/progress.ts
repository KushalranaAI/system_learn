import type { Graph, Incident, Resilience, Traffic } from "./engine";

/** A saved sandbox scenario: a design plus the traffic and incident to run it with. */
export interface Scenario {
  id: string;
  name: string;
  description: string;
  savedAt: string;
  graph: Graph;
  traffic: Traffic;
  incident?: Incident;
  resilience?: Resilience;
}

/** Local-first progress: everything lives in this browser. Export/import keeps it portable. */
export interface Progress {
  lessons: Record<string, boolean>;
  labs: Record<string, { step: number; done: number[]; graph?: Graph; graphStep?: number; api?: ApiRow[] }>;
  sandbox?: { graph: Graph; traffic: Traffic };
  scenarios?: Scenario[];
}

export interface ApiRow {
  method: string;
  path: string;
  status: number;
}

const KEY = "system-learn:progress:v1";

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { lessons: {}, labs: {}, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable - start fresh */
  }
  return { lessons: {}, labs: {} };
}

export function saveProgress(p: Progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage full or blocked - progress just won't persist */
  }
}

export function updateProgress(fn: (p: Progress) => void) {
  const p = loadProgress();
  fn(p);
  saveProgress(p);
}
