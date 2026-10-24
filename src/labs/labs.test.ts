import { describe, expect, it } from "vitest";
import { runDesignTest, type Graph } from "../engine";
import { simById } from "../sims";
import { goalMet } from "../sims/types";
import { LABS } from "./index";

describe("every lab design step", () => {
  for (const lab of LABS) {
    let previous: Graph | null = null;
    lab.steps.forEach((step, i) => {
      if (step.type === "sim") {
        it(`${lab.slug} #${i + 1} "${step.title}": the sim solution meets every goal and the start does not`, () => {
          const def = simById(step.sim);
          expect(def, `unknown sim ${step.sim}`).toBeTruthy();
          const start = def!.metrics(def!.run({ ...def!.defaults, ...step.params }));
          const solved = def!.metrics(def!.run({ ...def!.defaults, ...step.params, ...step.solution }));
          expect(step.goals.filter((g) => !goalMet(g, solved)).map((g) => `${g.label} (got ${solved[g.metric]})`)).toEqual([]);
          expect(step.goals.every((g) => goalMet(g, start))).toBe(false);
          for (const k of Object.keys(step.solution)) expect(step.locked ?? []).not.toContain(k);
        });
        return;
      }
      if (step.type !== "design") return;
      const prev = previous;
      it(`${lab.slug} #${i + 1} "${step.title}": the reference solution passes`, () => {
        const rep = runDesignTest(step.solution, step.test, { retries: true, dbFailover: false, ...step.solutionResilience });
        expect(rep.lines.filter((l) => !l.ok)).toEqual([]);
      });
      it(`${lab.slug} #${i + 1} "${step.title}": the starting design does not`, () => {
        const start = step.starter ?? prev;
        if (!start) return;
        const rep = runDesignTest(start, step.test, { retries: true, dbFailover: false });
        expect(rep.pass).toBe(false);
      });
      previous = step.solution;
    });
  }
});
