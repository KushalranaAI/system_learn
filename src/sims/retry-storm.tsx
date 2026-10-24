import { fmt, type SimDef } from "./types";
import { LineChart, Note } from "./ui";

type P = {
  clientRps: number;
  capacity: number;
  baseMs: number;
  timeoutMs: number;
  incidentFactor: number;
  retries: number;
  backoff: "none" | "exponential";
  jitter: boolean;
  budgetPct: number;
  breaker: boolean;
  queueLimitSec: number;
};

interface R {
  offered: number[];
  good: number[];
  capacity: number[];
  success: number[];
  queue: number[];
  userSuccess: number;
  peakAmplification: number;
  recoverySec: number;
}

const T = 120;
const INCIDENT = [30, 45];

/**
 * Discrete-time (1 s) model of a service under client retries.
 * The server has a FIFO queue; latency = queueing delay (M/M/1-like) + time to drain the queue ahead.
 * Each attempt succeeds if it completes before the client's timeout (latency ~ exponential with that mean).
 * Failed attempts are retried later according to the policy. Work for timed-out requests is still done
 * by the server (it doesn't know the client gave up) - which is what makes retry storms self-sustaining.
 */
export function runRetryStorm(p: P): R {
  const sched: number[][] = Array.from({ length: T + 300 }, () => new Array(p.retries + 1).fill(0));
  let q = 0;
  let breaker: "closed" | "open" | "half" = "closed";
  let openLeft = 0;
  const hist: number[] = [];
  const out: R = { offered: [], good: [], capacity: [], success: [], queue: [], userSuccess: 0, peakAmplification: 0, recoverySec: Infinity };
  let totalGood = 0;
  for (let t = 0; t < T; t++) {
    const attempts = sched[t];
    attempts[0] += p.clientRps;
    // Retry budget: retries may add at most budget% of the new-request rate.
    const retryDue = attempts.slice(1).reduce((a, b) => a + b, 0);
    const allowedRetries = p.budgetPct >= 100 ? Infinity : (p.budgetPct / 100) * p.clientRps;
    const retryScale = retryDue > allowedRetries ? allowedRetries / retryDue : 1;
    const send = attempts.map((n, k) => (k === 0 ? n : n * retryScale));

    let fraction = 1;
    if (p.breaker) {
      if (breaker === "open") fraction = 0;
      else if (breaker === "half") fraction = 0.1;
    }
    const sent = send.map((n) => n * fraction);
    const offered = sent.reduce((a, b) => a + b, 0);

    const cap = p.capacity * (t >= INCIDENT[0] && t < INCIDENT[1] ? p.incidentFactor : 1);
    q += offered;
    const processed = Math.min(q, cap);
    q -= processed;
    const qLimit = cap * p.queueLimitSec;
    let droppedFrac = 0;
    if (q > qLimit) {
      droppedFrac = offered > 0 ? Math.min(1, (q - qLimit) / offered) : 0;
      q = qLimit;
    }
    const util = processed / Math.max(cap, 1);
    const latency = p.baseMs / (1 - Math.min(util, 0.95)) + (q / Math.max(cap, 1)) * 1000;
    const okFrac = (1 - Math.exp(-p.timeoutMs / latency)) * (1 - droppedFrac);

    let good = 0;
    sent.forEach((n, k) => {
      const g = n * okFrac;
      good += g;
      const failed = n - g;
      if (k < p.retries && failed > 0) {
        const base = p.backoff === "exponential" ? 2 ** k : 1;
        if (p.jitter) {
          const span = Math.max(1, base * 2);
          for (let d = 1; d <= span; d++) sched[t + d][k + 1] += failed / span;
        } else sched[t + base][k + 1] += failed;
      }
    });
    totalGood += good;
    const success = offered > 0 ? okFrac : 0;
    hist.push(success);
    if (p.breaker) {
      const recent = hist.slice(-3);
      const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
      if (breaker === "closed" && t >= 2 && avg < 0.5) {
        breaker = "open";
        openLeft = 5;
      } else if (breaker === "open" && --openLeft <= 0) breaker = "half";
      else if (breaker === "half") {
        if (success >= 0.9) breaker = "closed";
        else {
          breaker = "open";
          openLeft = 5;
        }
      }
    }
    out.offered.push(offered);
    out.good.push(good);
    out.capacity.push(cap);
    out.success.push(success);
    out.queue.push(q);
  }
  out.userSuccess = Math.min(1, totalGood / (p.clientRps * T));
  out.peakAmplification = Math.max(...out.offered) / p.clientRps;
  for (let t = INCIDENT[1]; t < T; t++) {
    if (out.success.slice(t).every((s) => s >= 0.99)) {
      out.recoverySec = t - INCIDENT[1];
      break;
    }
  }
  return out;
}

export const retryStorm: SimDef<P, R> = {
  id: "retry-storm",
  title: "Retry storms",
  module: 12,
  lessons: ["12.2", "12.3", "7.4"],
  blurb: "A 15-second capacity drop. Naive retries turn it into an outage that never ends; backoff, jitter, retry budgets, load shedding and circuit breakers let it heal.",
  params: [
    { key: "clientRps", label: "Client requests/s", type: "number", min: 100, max: 5000, step: 100 },
    { key: "capacity", label: "Server capacity", type: "number", min: 200, max: 10000, step: 100, unit: "req/s" },
    { key: "incidentFactor", label: "Capacity during incident (t=30-45 s)", type: "number", min: 0.05, max: 1, step: 0.05, unit: "×" },
    { key: "timeoutMs", label: "Client timeout", type: "number", min: 100, max: 5000, step: 100, unit: "ms" },
    { key: "retries", label: "Retries per request", type: "number", min: 0, max: 5 },
    { key: "backoff", label: "Backoff", type: "select", options: [{ value: "none", label: "None (retry next second)" }, { value: "exponential", label: "Exponential (1, 2, 4, 8 s…)" }] },
    { key: "jitter", label: "Jitter (spread retries randomly)", type: "toggle" },
    { key: "budgetPct", label: "Retry budget (% of new traffic, 100 = unlimited)", type: "number", min: 0, max: 100, step: 5, unit: "%" },
    { key: "queueLimitSec", label: "Server queue limit", type: "number", min: 0.5, max: 30, step: 0.5, unit: "s of work", hint: "Short queues shed load instead of serving requests the client gave up on." },
    { key: "breaker", label: "Client circuit breaker", type: "toggle" },
  ],
  defaults: { clientRps: 1000, capacity: 1400, baseMs: 50, timeoutMs: 1000, incidentFactor: 0.3, retries: 3, backoff: "none", jitter: false, budgetPct: 100, breaker: false, queueLimitSec: 10 },
  run: runRetryStorm,
  metrics: (r) => ({ recovery: r.recoverySec, userSuccess: r.userSuccess, amplification: r.peakAmplification }),
  metricSpecs: [
    { key: "recovery", label: "Recovery after incident", format: fmt.s },
    { key: "userSuccess", label: "Overall success", format: fmt.pct },
    { key: "amplification", label: "Peak load ÷ client load", format: fmt.x },
  ],
  View: ({ p, r }) => (
    <>
      <LineChart
        yLabel="req/s"
        series={[
          { name: "Offered load (new + retries)", color: "var(--warm)", values: r.offered },
          { name: "Server capacity", color: "var(--muted)", values: r.capacity, dashed: true },
          { name: "Successful", color: "var(--good)", values: r.good },
        ]}
        markers={[{ x: INCIDENT[0], label: "capacity drops" }, { x: INCIDENT[1], label: "capacity back", color: "var(--good)" }]}
        hLines={[{ y: p.clientRps, label: "client load" }]}
      />
      <Note>
        Recovery is measured from t=45 s until every second succeeds ≥ 99%. If the offered load stays above capacity after the incident, the queue never
        drains and every request times out - a metastable failure.
      </Note>
    </>
  ),
};
