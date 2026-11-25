import { describe, expect, it } from "vitest";
import { EXPIRY_DAYS, planEvaluation } from "./plan";

const model = (id: string, created = 1, free = true) => ({ id, name: id, free, created });
const result = (ok: boolean, seconds = 5, date = "2026-11-24") => ({ ok, seconds, date });
const TODAY = "2026-11-25";
const SCENARIOS = ["a", "b", "c"];

describe("planEvaluation", () => {
  it("completes the scored models first, best first, then the new ones, newest first", () => {
    const models = [model("old/new:free", 1), model("recent/new:free", 2), model("good/model:free"), model("best/model:free"), model("paid/model", 3, false)];
    const scores = {
      "good/model:free": { a: result(true, 9) },
      "best/model:free": { a: result(true, 4), b: result(true, 4) },
    };

    expect(planEvaluation(models, scores, SCENARIOS, TODAY)).toEqual([
      { model: "best/model:free", scenario: "c" },
      { model: "good/model:free", scenario: "b" },
      { model: "good/model:free", scenario: "c" },
      ...SCENARIOS.map((scenario) => ({ model: "recent/new:free", scenario })),
      ...SCENARIOS.map((scenario) => ({ model: "old/new:free", scenario })),
    ]);
  });

  it("plans nothing when every free model listed is evaluated", () => {
    const scores = {
      "done/model:free": { a: result(true), b: result(false), c: result(true) },
      "failing/model:free": { a: result(false), b: result(false) },
      "unlisted/model:free": {},
    };
    const models = [model("done/model:free"), model("failing/model:free"), model("openrouter/free"), model("paid/model", 1, false)];

    expect(planEvaluation(models, scores, SCENARIOS, TODAY)).toEqual([]);
  });

  it("keeps completing a model after a first failure", () => {
    expect(planEvaluation([model("m/model:free")], { "m/model:free": { a: result(false) } }, SCENARIOS, TODAY)).toEqual([
      { model: "m/model:free", scenario: "b" },
      { model: "m/model:free", scenario: "c" },
    ]);
  });

  it("evaluates again the expired results of the models that can be recommended, after the scored models, before the new ones", () => {
    const old = (ok: boolean, date: string) => result(ok, 5, date);
    const scores = {
      "best/model:free": { a: old(true, "2026-11-01"), b: old(true, "2026-10-20"), c: old(true, "2026-11-11") },
      "good/model:free": { a: result(true) },
      // 1 failure (score 0.33): still completed, but its expired result is not run again
      "weak/model:free": { a: old(false, "2026-10-01") },
    };
    const models = [model("best/model:free"), model("good/model:free"), model("weak/model:free"), model("new/model:free")];

    // c (14 days old) is not expired yet
    expect(EXPIRY_DAYS).toBe(14);
    expect(planEvaluation(models, scores, SCENARIOS, TODAY)).toEqual([
      { model: "good/model:free", scenario: "b" },
      { model: "good/model:free", scenario: "c" },
      { model: "weak/model:free", scenario: "b" },
      { model: "weak/model:free", scenario: "c" },
      { model: "best/model:free", scenario: "b" },
      { model: "best/model:free", scenario: "a" },
      ...SCENARIOS.map((scenario) => ({ model: "new/model:free", scenario })),
    ]);
  });
});
