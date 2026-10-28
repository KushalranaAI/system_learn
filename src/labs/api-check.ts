import type { ApiRow } from "../progress";
import type { ApiExpectation } from "./types";

/** Which requirements of an API-design step a list of endpoints meets. */
export function checkApi(rows: ApiRow[], expect: ApiExpectation[]) {
  return expect.map((x) => {
    const match = rows.find(
      (r) =>
        x.methods.includes(r.method) &&
        x.statuses.includes(r.status) &&
        (!x.needsParam || /\/:[a-zA-Z_]+|\{[a-zA-Z_]+\}/.test(r.path)) &&
        (!x.pathMatch || new RegExp(x.pathMatch, "i").test(r.path)),
    );
    return { goal: x.goal, ok: !!match, why: x.why };
  });
}
