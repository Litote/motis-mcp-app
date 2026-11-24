import { describe, expect, it } from "vitest";
import { planEvaluation } from "./plan";

const model = (id: string, created = 1, free = true) => ({ id, name: id, free, created });
const result = (ok: boolean, seconds = 5) => ({ ok, seconds, date: "2026-11-24" });
const SCENARIOS = ["a", "b", "c"];

describe("planEvaluation", () => {
  it("completes the scored models first, best first, then the new ones, newest first", () => {
    const models = [model("old/new:free", 1), model("recent/new:free", 2), model("good/model:free"), model("best/model:free"), model("paid/model", 3, false)];
    const scores = {
      "good/model:free": { a: result(true, 9) },
      "best/model:free": { a: result(true, 4), b: result(true, 4) },
    };

    expect(planEvaluation(models, scores, SCENARIOS, 100)).toEqual([
      { model: "best/model:free", scenario: "c" },
      { model: "good/model:free", scenario: "b" },
      { model: "good/model:free", scenario: "c" },
      ...SCENARIOS.map((scenario) => ({ model: "recent/new:free", scenario })),
      ...SCENARIOS.map((scenario) => ({ model: "old/new:free", scenario })),
    ]);
    expect(planEvaluation(models, scores, SCENARIOS, 2)).toHaveLength(2);
  });

  it("plans nothing when every free model listed is evaluated", () => {
    const scores = {
      "done/model:free": { a: result(true), b: result(false), c: result(true) },
      "failing/model:free": { a: result(false), b: result(false) },
      "unlisted/model:free": {},
    };
    const models = [model("done/model:free"), model("failing/model:free"), model("openrouter/free"), model("paid/model", 1, false)];

    expect(planEvaluation(models, scores, SCENARIOS, 100)).toEqual([]);
  });

  it("keeps completing a model after a first failure", () => {
    expect(planEvaluation([model("m/model:free")], { "m/model:free": { a: result(false) } }, SCENARIOS, 100)).toEqual([
      { model: "m/model:free", scenario: "b" },
      { model: "m/model:free", scenario: "c" },
    ]);
  });
});
