export interface Lesson {
  slug: string;
  module: number;
  lesson: string;
  title: string;
  minutes: number;
  type: "lesson" | "lab";
  body: string;
  moduleDir: string;
}

const files = import.meta.glob("../../content/**/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

function parse(path: string, raw: string): Lesson | null {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return null;
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].replace(/^"(.*)"$/, "$1").trim();
  }
  if (!meta.lesson) return null;
  const parts = path.split("/");
  return {
    slug: parts[parts.length - 1].replace(/\.md$/, ""),
    moduleDir: parts[parts.length - 2],
    module: Number(meta.module),
    lesson: meta.lesson,
    title: meta.title ?? meta.lesson,
    minutes: Number(meta.minutes ?? 5),
    type: meta.type === "lab" ? "lab" : "lesson",
    body: m[2],
  };
}

export const LESSONS: Lesson[] = Object.entries(files)
  .map(([p, raw]) => parse(p, raw))
  .filter((l): l is Lesson => !!l)
  .sort((a, b) => a.module - b.module || a.lesson.localeCompare(b.lesson, undefined, { numeric: true }));

export const CURRICULUM: string = files["../../content/curriculum.md"] ?? "";

export interface ModuleOutline {
  part: string;
  number: number;
  title: string;
  lessons: { id: string; title: string; learn: string }[];
}

/** Parses the module tables in curriculum.md into a structured outline. */
export function outline(): ModuleOutline[] {
  const out: ModuleOutline[] = [];
  let part = "";
  for (const line of CURRICULUM.split(/\r?\n/)) {
    const p = line.match(/^## (.+)$/);
    if (p) part = p[1];
    const h = line.match(/^### Module (\d+) [–-] (.+)$/);
    if (h) out.push({ part, number: +h[1], title: h[2], lessons: [] });
    const row = line.match(/^\|\s*(\d+\.\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/);
    if (row && out.length) out[out.length - 1].lessons.push({ id: row[1], title: row[2], learn: row[3] });
  }
  return out;
}

export const lessonById = (id: string) => LESSONS.find((l) => l.lesson === id);
