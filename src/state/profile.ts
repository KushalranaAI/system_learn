import { REFERENCE_PROFILE, setActiveProfile, type CapacityProfile } from "../engine";

export interface MeasuredProfile extends CapacityProfile {
  measuredAt: string;
  machine: { cpu: string; cores: number; ramGB: number; os: string; node: string; hostname: string };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: any;
  method: Record<string, string>;
}

// Written by `npm run bench` (or the "My machine" page). Absent until you run it.
const found = import.meta.glob("./calibration/measured.json", { eager: true, import: "default" }) as Record<string, MeasuredProfile>;
export const MEASURED: MeasuredProfile | null = Object.values(found)[0] ?? null;

export type ProfileId = "reference" | "measured";
const KEY = "system-learn:profile";

export function savedProfileId(): ProfileId {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "measured" && MEASURED) return "measured";
  } catch {
    /* ignore */
  }
  // Presets and lessons are tuned to the reference numbers; use your machine's numbers once you pick them.
  return "reference";
}

export function saveProfileId(id: ProfileId) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* ignore */
  }
}

export const profileFor = (id: ProfileId): CapacityProfile => (id === "measured" && MEASURED ? MEASURED : REFERENCE_PROFILE);

export function applyProfile(id: ProfileId) {
  setActiveProfile(profileFor(id));
}
