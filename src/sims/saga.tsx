import { rng } from "./rng";
import { fmt, type SimDef } from "./types";
import { Bars, Note } from "./ui";

type P = {
  orders: number;
  stockFailPct: number;
  declinePct: number;
  timeoutPct: number;
  crashPct: number;
  redeliverPct: number;
  compensate: boolean;
  timeoutHandling: "fail" | "query";
  idempotencyKeys: boolean;
  outbox: boolean;
  dedupeConsumers: boolean;
};

interface R {
  completed: number;
  cancelled: number;
  problems: Record<string, number>;
  inconsistent: number;
}

const PROBLEMS = ["stock leaked", "charged, no order", "charged twice", "paid, never shipped", "shipped twice"] as const;

/**
 * Each order runs: create (pending) → reserve stock → authorise payment → confirm + publish OrderConfirmed → ship.
 * Failures are injected at each step with the given probabilities. A timeout from the card provider is ambiguous:
 * the card was charged in half of the cases. A crash between "commit" and "publish" loses the event unless an
 * outbox is used; consumers sometimes receive an event twice.
 */
export function runSaga(p: P): R {
  const r = rng(16);
  const problems: Record<string, number> = Object.fromEntries(PROBLEMS.map((k) => [k, 0]));
  let completed = 0;
  let cancelled = 0;
  for (let i = 0; i < p.orders; i++) {
    if (r() < p.stockFailPct / 100) {
      cancelled++;
      continue;
    }
    const u = r();
    let authorised = true;
    if (u < p.declinePct / 100) {
      if (p.compensate) cancelled++;
      else problems["stock leaked"]++;
      continue;
    } else if (u < (p.declinePct + p.timeoutPct) / 100) {
      const reallyCharged = r() < 0.5;
      if (p.timeoutHandling === "fail") {
        // treated as a decline: compensate (or not), but the card may have been charged
        if (!p.compensate) problems["stock leaked"]++;
        if (reallyCharged) problems["charged, no order"]++;
        if (p.compensate && !reallyCharged) cancelled++;
        continue;
      }
      // retry / query status
      if (!p.idempotencyKeys && reallyCharged) {
        problems["charged twice"]++;
        continue;
      }
      authorised = true;
    }
    if (!authorised) continue;
    if (r() < p.crashPct / 100 && !p.outbox) {
      problems["paid, never shipped"]++;
      continue;
    }
    if (r() < p.redeliverPct / 100 && !p.dedupeConsumers) {
      problems["shipped twice"]++;
      continue;
    }
    completed++;
  }
  const bad = Object.values(problems).reduce((a, b) => a + b, 0);
  return { completed: completed / p.orders, cancelled: cancelled / p.orders, problems, inconsistent: bad / p.orders };
}

export const saga: SimDef<P, R> = {
  id: "saga",
  title: "Sagas under failure",
  module: 16,
  lessons: ["16.3", "16.4", "15.4", "12.4"],
  blurb: "5,000 orders through orders → inventory → payments → shipping, with declines, ambiguous timeouts, crashes and duplicate deliveries. Count every order that ends up inconsistent.",
  params: [
    { key: "orders", label: "Orders", type: "number", min: 1000, max: 20000, step: 1000 },
    { key: "stockFailPct", label: "Out of stock", type: "number", min: 0, max: 30, unit: "%" },
    { key: "declinePct", label: "Card declined", type: "number", min: 0, max: 30, unit: "%" },
    { key: "timeoutPct", label: "Payment call times out", type: "number", min: 0, max: 20, unit: "%" },
    { key: "crashPct", label: "Crash between commit and publish", type: "number", min: 0, max: 10, unit: "%" },
    { key: "redeliverPct", label: "Event delivered twice", type: "number", min: 0, max: 20, unit: "%" },
    { key: "compensate", label: "Compensating actions (release stock, cancel order)", type: "toggle" },
    { key: "timeoutHandling", label: "On payment timeout", type: "select", options: [{ value: "fail", label: "Treat as declined" }, { value: "query", label: "Retry / query the outcome" }] },
    { key: "idempotencyKeys", label: "Idempotency key on payment calls", type: "toggle" },
    { key: "outbox", label: "Transactional outbox for events", type: "toggle" },
    { key: "dedupeConsumers", label: "Consumers dedupe by event id (inbox)", type: "toggle" },
  ],
  defaults: { orders: 5000, stockFailPct: 8, declinePct: 5, timeoutPct: 3, crashPct: 2, redeliverPct: 5, compensate: false, timeoutHandling: "fail", idempotencyKeys: false, outbox: false, dedupeConsumers: false },
  run: runSaga,
  metrics: (r) => ({ inconsistent: r.inconsistent, completed: r.completed, cancelled: r.cancelled }),
  metricSpecs: [
    { key: "inconsistent", label: "Orders left inconsistent", format: fmt.pct2 },
    { key: "completed", label: "Completed", format: fmt.pct },
    { key: "cancelled", label: "Cleanly cancelled", format: fmt.pct },
  ],
  View: ({ p, r }) => (
    <>
      <Bars yLabel="orders left inconsistent, by problem" values={PROBLEMS.map((k) => r.problems[k])} labels={PROBLEMS.map((k) => k)} color={(v) => (v ? "var(--bad)" : "var(--good)")} />
      <Note>
        Out of {p.orders.toLocaleString()} orders, {PROBLEMS.map((k) => `${r.problems[k]} ${k}`).join(" · ")}. Every one of these is a support ticket - or money
        you owe. A correct saga cancels cleanly or completes; it never ends in between.
      </Note>
    </>
  ),
};
