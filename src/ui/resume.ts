import { LESSONS, type Lesson } from "../content/lessons";
import { LABS, type Lab } from "../labs";
import type { Progress } from "../progress";

/** The first written lesson the learner hasn't finished, in path order. */
export function nextLesson(p: Progress): Lesson | undefined {
  return LESSONS.find((l) => !p.lessons[l.lesson]);
}

/** Labs that are started but not finished, so the learner can jump straight back in. */
export function labsInProgress(p: Progress): { lab: Lab; done: number }[] {
  return LABS.map((lab) => ({ lab, done: p.labs[lab.slug]?.done.length ?? 0 })).filter((x) => x.done > 0 && x.done < x.lab.steps.length);
}

export const lessonsDone = (p: Progress) => LESSONS.filter((l) => p.lessons[l.lesson]).length;
