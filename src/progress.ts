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
  /** curriculum numbering the lesson ids were saved under (missing = 1) */
  pathVersion?: number;
}

export interface ApiRow {
  method: string;
  path: string;
  status: number;
}

const KEY = "system-learn:progress:v1";

/** Version 2 inserted Part 3 (API design) as modules 19-25, so old modules 19-30 became 26-37. */
export const PATH_VERSION = 2;

export function migrateProgress(p: Progress): Progress {
  if ((p.pathVersion ?? 1) < 2) {
    const lessons: Record<string, boolean> = {};
    for (const [id, done] of Object.entries(p.lessons ?? {})) {
      const m = id.match(/^(\d+)\.(\d+)$/);
      const mod = m ? +m[1] : 0;
      lessons[m && mod >= 19 && mod <= 30 ? `${mod + 7}.${m[2]}` : id] = done;
    }
    p = { ...p, lessons };
  }
  return { ...p, pathVersion: PATH_VERSION };
}

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return migrateProgress({ lessons: {}, labs: {}, ...JSON.parse(raw) });
  } catch {
    /* storage unavailable - start fresh */
  }
  return { lessons: {}, labs: {}, pathVersion: PATH_VERSION };
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
