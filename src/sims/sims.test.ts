import { describe, expect, it } from "vitest";
import { EXPLAIN } from "./explain";
import { SIMS } from "./index";

describe("every simulation", () => {
  for (const s of SIMS)
    it(`${s.id} runs with its defaults and explains itself`, () => {
      const m = s.metrics(s.run(s.defaults));
      for (const spec of s.metricSpecs) expect(m[spec.key], spec.key).not.toBeUndefined();
      const e = EXPLAIN[s.id]?.(s.defaults, m);
      expect(e, `missing explanation for ${s.id}`).toBeTruthy();
      expect(e!.scenario.length).toBeGreaterThan(20);
      expect(e!.outcome.length).toBeGreaterThan(10);
    });
});
