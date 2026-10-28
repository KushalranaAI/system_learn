import { describe, expect, it } from "vitest";
import { lessonById, outline } from "./content/lessons";
import { migrateProgress, PATH_VERSION } from "./progress";

describe("progress migration", () => {
  it("moves lessons from old modules 19-30 to 26-37 and leaves the rest alone", () => {
    const p = migrateProgress({ lessons: { "2.3": true, "18.7": true, "19.2": true, "24.14": true, "30.8": false }, labs: {} });
    expect(p.lessons).toEqual({ "2.3": true, "18.7": true, "26.2": true, "31.14": true, "37.8": false });
    expect(p.pathVersion).toBe(PATH_VERSION);
  });

  it("does nothing to progress saved under the current numbering", () => {
    const saved = { lessons: { "19.2": true, "26.2": true }, labs: {}, pathVersion: PATH_VERSION };
    expect(migrateProgress(saved).lessons).toEqual(saved.lessons);
  });
});

describe("the curriculum", () => {
  it("has a written lesson for every row in Part 3 (API design)", () => {
    const missing = outline()
      .filter((m) => m.part.startsWith("Part 3"))
      .flatMap((m) => m.lessons.filter((l) => !lessonById(l.id)).map((l) => l.id));
    expect(missing).toEqual([]);
  });

  it("lists parts in order with modules numbered 1-37", () => {
    const mods = outline();
    expect(mods.map((m) => m.number)).toEqual(Array.from({ length: 37 }, (_, i) => i + 1));
    expect([...new Set(mods.map((m) => m.part.split(" – ")[0]))]).toEqual(["Part 1", "Part 2", "Part 3", "Part 4", "Part 5"]);
  });
});
