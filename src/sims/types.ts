import type { ReactNode } from "react";

export type ParamValue = number | string | boolean;
export type Params = Record<string, ParamValue>;

export interface ParamSpec {
  key: string;
  label: string;
  type: "number" | "select" | "toggle";
  min?: number;
  max?: number;
  step?: number;
  /** slider moves on a log scale (for values spanning orders of magnitude) */
  log?: boolean;
  unit?: string;
  options?: { value: string | number; label: string }[];
  hint?: string;
}

export interface MetricSpec {
  key: string;
  label: string;
  format: (v: number) => string;
}

export interface Goal {
  metric: string;
  op: "<=" | ">=";
  value: number;
  label: string;
}

export interface SimDef<P extends Params = Params, R = unknown> {
  id: string;
  title: string;
  module: number;
  /** lessons this simulation illustrates (shown embedded on those lesson pages) */
  lessons: string[];
  blurb: string;
  params: ParamSpec[];
  defaults: P;
  run: (p: P) => R;
  metrics: (r: R) => Record<string, number>;
  metricSpecs: MetricSpec[];
  View: (props: { p: P; r: R }) => ReactNode;
}

export const fmt = {
  pct: (v: number) => (!Number.isFinite(v) ? "-" : `${(v * 100).toFixed(v > 0.999 && v < 1 ? 2 : 1)}%`),
  pct2: (v: number) => (!Number.isFinite(v) ? "-" : `${(v * 100).toFixed(2)}%`),
  ms: (v: number) => (!Number.isFinite(v) ? "∞" : `${Math.round(v)} ms`),
  s: (v: number) => (!Number.isFinite(v) ? "never" : `${v.toFixed(v < 10 ? 1 : 0)} s`),
  n: (v: number) => (!Number.isFinite(v) ? "∞" : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${Math.round(v / 1e3)}k` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : `${Math.round(v * 10) / 10}`),
  x: (v: number) => `${v.toFixed(2)}×`,
  kb: (v: number) => (v >= 1024 ? `${(v / 1024).toFixed(1)} MB` : `${v.toFixed(1)} KB`),
};

export function goalMet(g: Goal, metrics: Record<string, number>): boolean {
  const v = metrics[g.metric];
  if (v === undefined || Number.isNaN(v)) return false;
  return g.op === "<=" ? v <= g.value + 1e-12 : v >= g.value - 1e-12;
}
