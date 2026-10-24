import type { DesignTest, Graph, NodeKind } from "../engine";
import type { Goal, Params } from "../sims/types";

export interface ApiExpectation {
  /** what the learner should design, e.g. "Create a short link" */
  goal: string;
  methods: string[];
  statuses: number[];
  /** path must contain a :param segment */
  needsParam?: boolean;
  why: string;
}

export type LabStep =
  | { type: "intro"; title: string; body: string }
  | {
      type: "quiz";
      title: string;
      body: string;
      question: string;
      options: { text: string; correct?: boolean; why: string }[];
    }
  | { type: "api"; title: string; body: string; baseUrl: string; expect: ApiExpectation[] }
  | {
      type: "design";
      title: string;
      body: string;
      /** fresh canvas for this step; otherwise the previous step's design carries over */
      starter?: Graph;
      palette?: NodeKind[];
      test: DesignTest;
      hints: string[];
      /** a reference design that passes - shown on request and verified by tests */
      solution: Graph;
      /** turn these on in the solution (labs with incidents) */
      solutionResilience?: { retries?: boolean; dbFailover?: boolean };
    }
  | {
      /** a hands-on simulation with measurable goals */
      type: "sim";
      title: string;
      body: string;
      sim: string;
      /** starting parameters (merged over the simulation's defaults) */
      params?: Params;
      /** parameters the learner can't change in this step */
      locked?: string[];
      goals: Goal[];
      hints: string[];
      /** parameter changes that meet every goal - verified by tests */
      solution: Params;
    };

export interface Lab {
  slug: string;
  /** curriculum module this lab belongs to */
  module?: number;
  title: string;
  product: string;
  summary: string;
  difficulty: "easy" | "medium" | "hard";
  minutes: number;
  tags: string[];
  steps: LabStep[];
}
