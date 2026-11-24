import { describe, expect, it } from "vitest";
import { MIN_SCORE, rankModels, scoreOf, type ScenarioResult } from "./modelScores";

const result = (ok: boolean, seconds = 5): ScenarioResult => ({ ok, seconds, date: "2026-11-24" });
const results = (passed: number, failed: number, seconds = 5) =>
  Object.fromEntries([...Array(passed)].map((_, i) => [`ok${i}`, result(true, seconds)]).concat([...Array(failed)].map((_, i) => [`ko${i}`, result(false, seconds)])));

describe("scoreOf", () => {
  it("does not rank a model with few runs above one with many and a few failures", () => {
    expect(scoreOf("a", results(1, 0)).score).toBeCloseTo(2 / 3);
    expect(scoreOf("b", results(15, 1)).score).toBeCloseTo(16 / 18);
    expect(scoreOf("c", { x: result(true, 4), y: result(false, 8) })).toEqual({ model: "c", passed: 1, runs: 2, score: 0.5, seconds: 6 });
  });
});

describe("rankModels", () => {
  it("ranks by score, then speed, without the models under the minimum score", () => {
    const ranked = rankModels({
      slow: results(3, 0, 9),
      fast: results(3, 0, 4),
      many: results(15, 1),
      bad: results(0, 2),
    });
    expect(ranked.map((s) => s.model)).toEqual(["many", "fast", "slow"]);
    expect(scoreOf("bad", results(0, 2)).score).toBeLessThan(MIN_SCORE);
  });

  it("ranks the models of model-scores.json by default", () => {
    for (const s of rankModels()) expect(s.score).toBeGreaterThanOrEqual(MIN_SCORE);
  });
});
