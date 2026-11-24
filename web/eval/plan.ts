/**
 * Plan of the daily evaluation (EVAL_AUTO, .github/workflows/model-scores.yml): the scenarios still without result of
 * the free models listed by OpenRouter, so that the scores get completed a few runs a day. Pure, tested in plan.test.ts.
 */
import { MIN_SCORE, scoreOf, type ModelScores } from "../src/modelScores";
import type { Model } from "../src/openrouter";

export interface PlannedRun {
  model: string;
  scenario: string;
}

/** Failures after which a model scoring under [MIN_SCORE] is no longer completed: it will not be recommended. */
const GIVE_UP_FAILURES = 2;

/**
 * Runs to do, at most [maxRuns]: for each free model of [models] (the OpenRouter router excepted), the scenarios of
 * [scenarioIds] without result in [scores]. The models already scored come first, best first (the recommended one is
 * confirmed first), then the models never evaluated, newest first. A model that failed [GIVE_UP_FAILURES] times and
 * scores under [MIN_SCORE] is left out. Empty when every free model is evaluated: nothing to consume.
 */
export function planEvaluation(
  models: readonly Model[],
  scores: ModelScores,
  scenarioIds: readonly string[],
  maxRuns: number,
): PlannedRun[] {
  const candidates = models
    .filter((m) => m.free && !m.id.startsWith("openrouter/"))
    .map((m) => {
      const results = scores[m.id] ?? {};
      const score = scoreOf(m.id, results);
      return { model: m, score, missing: scenarioIds.filter((id) => !(id in results)) };
    })
    .filter((c) => c.missing.length > 0)
    .filter((c) => !(c.score.runs - c.score.passed >= GIVE_UP_FAILURES && c.score.score < MIN_SCORE));
  const scored = candidates.filter((c) => c.score.runs > 0).sort((a, b) => b.score.score - a.score.score || a.score.seconds - b.score.seconds);
  const unscored = candidates.filter((c) => c.score.runs === 0).sort((a, b) => b.model.created - a.model.created || a.model.id.localeCompare(b.model.id));
  return [...scored, ...unscored].flatMap((c) => c.missing.map((scenario) => ({ model: c.model.id, scenario }))).slice(0, Math.max(0, maxRuns));
}
