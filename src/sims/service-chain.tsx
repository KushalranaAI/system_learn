import { lognormal, percentile, rng } from "./rng";
import { fmt, type SimDef } from "./types";
import { Histogram, Note } from "./ui";

type P = {
  services: number;
  p50: number;
  tail: number;
  availability: number;
  mode: "sequential" | "parallel";
  critical: number;
  asyncSideEffects: boolean;
  timeoutMs: number;
  fallback: boolean;
};

interface R {
  latencies: number[];
  success: number;
  degraded: number;
  perRequestCalls: number;
}

const N = 20_000;

/**
 * Monte Carlo over N requests. Each service call has a lognormal latency (given p50 and p99) and fails
 * with probability 1 − availability. Calls slower than the timeout are cut off and count as failures.
 * Critical failures fail the request; non-critical ones fail it unless there's a fallback.
 * With async side effects, non-critical services are called via events after the response.
 */
export function runServiceChain(p: P): R {
  const r = rng(11);
  const latencies: number[] = [];
  let ok = 0;
  let degraded = 0;
  const p99 = p.p50 * p.tail;
  const critical = Math.min(p.critical, p.services);
  const onPath = p.asyncSideEffects ? critical : p.services;
  for (let i = 0; i < N; i++) {
    let total = 0;
    let max = 0;
    let failed = false;
    let deg = false;
    for (let s = 0; s < onPath; s++) {
      let lat = lognormal(r, p.p50, p99);
      let fail = r() > p.availability;
      if (p.timeoutMs > 0 && lat > p.timeoutMs) {
        lat = p.timeoutMs;
        fail = true;
      }
      const isCritical = s < critical;
      if (fail) {
        if (!isCritical && p.fallback) deg = true;
        else failed = true;
      }
      total += lat;
      max = Math.max(max, lat);
    }
    const lat = p.mode === "sequential" ? total : max + 2;
    latencies.push(lat);
    if (!failed) {
      ok++;
      if (deg) degraded++;
    }
  }
  return { latencies, success: ok / N, degraded: degraded / N, perRequestCalls: onPath };
}

export const serviceChain: SimDef<P, R> = {
  id: "service-chain",
  title: "Service call chains",
  module: 11,
  lessons: ["11.3", "11.4", "12.3"],
  blurb: "20,000 requests through a chain of microservices: watch latency add up and availability multiply, then fix it with parallel calls, timeouts, fallbacks and async side effects.",
  params: [
    { key: "services", label: "Services per request", type: "number", min: 1, max: 10 },
    { key: "p50", label: "Each service p50", type: "number", min: 5, max: 200, unit: "ms" },
    { key: "tail", label: "Tail: p99 ÷ p50", type: "number", min: 1.5, max: 20, step: 0.5, unit: "×" },
    { key: "availability", label: "Each service's availability", type: "select", options: [{ value: 0.99, label: "99%" }, { value: 0.999, label: "99.9%" }, { value: 0.9995, label: "99.95%" }, { value: 0.9999, label: "99.99%" }] },
    { key: "mode", label: "Call style", type: "select", options: [{ value: "sequential", label: "Sequential (A → B → C …)" }, { value: "parallel", label: "Parallel (fan out, wait for all)" }] },
    { key: "critical", label: "Critical services", type: "number", min: 1, max: 10, hint: "Services the request truly can't succeed without (e.g. orders, payments)." },
    { key: "asyncSideEffects", label: "Non-critical calls via events (after the response)", type: "toggle" },
    { key: "timeoutMs", label: "Per-call timeout (0 = none)", type: "number", min: 0, max: 2000, step: 10, unit: "ms" },
    { key: "fallback", label: "Fallback for non-critical failures", type: "toggle" },
  ],
  defaults: { services: 6, p50: 30, tail: 6, availability: 0.999, mode: "sequential", critical: 6, asyncSideEffects: false, timeoutMs: 0, fallback: false },
  run: runServiceChain,
  metrics: (r) => ({ p50: percentile(r.latencies, 0.5), p99: percentile(r.latencies, 0.99), success: r.success, degraded: r.degraded }),
  metricSpecs: [
    { key: "p50", label: "p50 latency", format: fmt.ms },
    { key: "p99", label: "p99 latency", format: fmt.ms },
    { key: "success", label: "Success rate", format: fmt.pct2 },
    { key: "degraded", label: "Served degraded", format: fmt.pct2 },
  ],
  View: ({ p, r }) => {
    const p99 = percentile(r.latencies, 0.99);
    return (
      <>
        <div className="chain">
          {Array.from({ length: p.services }, (_, i) => {
            const crit = i < p.critical;
            const off = p.asyncSideEffects && !crit;
            return (
              <span key={i} className={`svc${crit ? " crit" : ""}${off ? " off" : ""}`}>
                {crit ? "★" : ""}S{i + 1}{off ? " (event)" : ""}
              </span>
            );
          })}
        </div>
        <Histogram values={r.latencies} max={Math.max(100, p99 * 1.6)} marks={[{ v: percentile(r.latencies, 0.5), label: "p50" }, { v: p99, label: "p99" }]} />
        <Note>
          {r.perRequestCalls} calls on the request path. In series, availabilities multiply ({fmt.pct2(Math.pow(p.availability, r.perRequestCalls))} before fallbacks) and latencies add;
          in parallel, the request waits for the slowest call.
        </Note>
      </>
    );
  },
};
