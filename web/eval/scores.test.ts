import { describe, expect, it } from "vitest";
import type { RunRecord } from "./checks";
import type { Run } from "./report";
import { SCENARIOS } from "./scenarios";
import { mergeScores } from "./scores";

const [first, second] = SCENARIOS;
const record = (error?: string): RunRecord => ({ calls: [], answer: "Done", complete: true, steps: 1, error });
const run = (model: string, scenario: (typeof SCENARIOS)[number], ok: boolean, error?: string): Run => ({
  model,
  scenario,
  record: record(error),
  checks: [{ label: "check", ok }],
  seconds: 4.26,
});

describe("mergeScores", () => {
  it("replaces the previous result of a model and scenario, keeps the others, sorted", () => {
    const scores = {
      "z/model:free": { [first.id]: { ok: false, seconds: 9, date: "2026-11-08" }, [second.id]: { ok: true, seconds: 3, date: "2026-11-08" } },
    };
    const merged = mergeScores(scores, [run("z/model:free", first, true), run("a/model:free", second, false)], "2026-11-24", [first.id, second.id]);

    expect(merged).toEqual({
      "a/model:free": { [second.id]: { ok: false, seconds: 4.3, date: "2026-11-24" } },
      "z/model:free": { [first.id]: { ok: true, seconds: 4.3, date: "2026-11-24" }, [second.id]: { ok: true, seconds: 3, date: "2026-11-08" } },
    });
    expect(Object.keys(merged)).toEqual(["a/model:free", "z/model:free"]);
    // not changed in place
    expect(scores["z/model:free"][first.id].ok).toBe(false);
  });

  it("leaves out the runs ended by an error, and the scenarios removed", () => {
    const scores = { "a/model:free": { removed: { ok: true, seconds: 1, date: "2026-11-08" } } };
    const merged = mergeScores(scores, [run("b/model:free", first, false, "Rate limited by OpenRouter")], "2026-11-24", [first.id]);

    expect(merged).toEqual({});
  });
});
