import type { NodeConfig } from "./types";

/** Failure rates a checkout saga meets in practice (the same model as the saga simulation). */
export const SAGA_RATES = { stock: 0.08, decline: 0.05, timeout: 0.03, crash: 0.02, redeliver: 0.05 };

export const SAGA_CAUSES = ["stock leaked", "charged, no order", "charged twice", "paid, never shipped", "shipped twice"] as const;
export type SagaCause = (typeof SAGA_CAUSES)[number];

/**
 * Expected share of orders that end inconsistent, by cause, for a saga with the given safeguards.
 * Order: reserve stock → authorise payment (decline / ambiguous timeout, charged half the time) →
 * commit + publish (crash in between) → consumers (duplicate delivery).
 */
export function sagaOutcome(c: NodeConfig): { inconsistent: number; causes: Record<SagaCause, number> } {
  const { stock, decline, timeout, crash, redeliver } = SAGA_RATES;
  const causes: Record<SagaCause, number> = { "stock leaked": 0, "charged, no order": 0, "charged twice": 0, "paid, never shipped": 0, "shipped twice": 0 };
  const reserved = 1 - stock;
  if (!c.compensate) causes["stock leaked"] += reserved * decline;
  let proceed = reserved * (1 - decline - timeout);
  if (!c.queryTimeouts) {
    // timeout treated as a decline: if the card was charged (half the time) we kept the money without an order
    if (!c.compensate) causes["stock leaked"] += reserved * timeout * 0.5;
    causes["charged, no order"] += reserved * timeout * 0.5;
  } else if (!c.idempotencyKeys) {
    // retried without an idempotency key: charged again when the first attempt had succeeded
    causes["charged twice"] += reserved * timeout * 0.5;
    proceed += reserved * timeout * 0.5;
  } else proceed += reserved * timeout;
  if (!c.outbox) {
    causes["paid, never shipped"] += proceed * crash;
    proceed *= 1 - crash;
  }
  if (!c.dedupeConsumers) causes["shipped twice"] += proceed * redeliver;
  const inconsistent = Object.values(causes).reduce((a, b) => a + b, 0);
  return { inconsistent, causes };
}
