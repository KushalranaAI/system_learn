import { PRESETS, type Preset } from "../presets";
import { AI_SCENARIOS } from "./ai";
import { API_SCENARIOS } from "./api";
import { CASE_STUDIES } from "./case-studies";
import { INTERVIEW } from "./interview";
import { OUTAGES } from "./outages";

/** Every sandbox starting point, in the order the sandbox lists them. */
export const SCENARIOS: Preset[] = [
  ...PRESETS.map((p) => ({ ...p, category: p.category ?? ("basics" as const) })),
  ...INTERVIEW.map((p) => ({ ...p, category: "interview" as const })),
  ...API_SCENARIOS.map((p) => ({ ...p, category: "api" as const })),
  ...CASE_STUDIES.map((p) => ({ ...p, category: "case-study" as const })),
  ...OUTAGES.map((p) => ({ ...p, category: "outage" as const })),
  ...AI_SCENARIOS.map((p) => ({ ...p, category: "ai" as const })),
];

export const scenarioById = (id: string | null) => SCENARIOS.find((s) => s.id === id);
