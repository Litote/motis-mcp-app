/**
 * Plan of the daily evaluation (EVAL_AUTO, .github/workflows/model-scores.yml): the scenarios still without result of
 * the free models listed by OpenRouter, then their expired results, so that the scores get completed and kept up to
 * date a few runs a day. Pure, tested in plan.test.ts.
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
 * Age in days after which a result is run again, for a model scoring at least [MIN_SCORE] (recommended or fallback): a
 * model that changed, or got worse, gets a new score.
 */
export const EXPIRY_DAYS = 14;

/** Days from [from] to [to], both YYYY-MM-DD. */
function daysBetween(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / 86_400_000;
}

/**
 * Runs to do on day [today] (YYYY-MM-DD), for the free models of [models] (the OpenRouter router excepted), in this
 * order: the scenarios of [scenarioIds] without result in [scores] of the models already scored, best first (the
 * recommended one is confirmed first); then the results older than [EXPIRY_DAYS] of the models scoring at least
 * [MIN_SCORE], best first and oldest first for a model, so that the recommended model and its fallbacks are kept up to
 * date even while many new models wait; then the models never evaluated, newest first. A model that failed
 * [GIVE_UP_FAILURES] times and scores under [MIN_SCORE] is left out. Not cut to a budget: the evaluation stops calling
 * once its budget is spent, and skips a model failing in a row without calling it, so that such a model does not hold
 * back the runs after it. Empty when every free model is evaluated and up to date: nothing to consume.
 */
export function planEvaluation(models: readonly Model[], scores: ModelScores, scenarioIds: readonly string[], today: string): PlannedRun[] {
  const candidates = models
    .filter((m) => m.free && !m.id.startsWith("openrouter/"))
    .map((m) => {
      const results = scores[m.id] ?? {};
      const score = scoreOf(m.id, results);
      const missing = scenarioIds.filter((id) => !(id in results));
      const expired =
        score.score < MIN_SCORE
          ? []
          : scenarioIds
              .filter((id) => id in results && daysBetween(results[id].date, today) > EXPIRY_DAYS)
              .sort((a, b) => results[a].date.localeCompare(results[b].date) || a.localeCompare(b));
      return { model: m, score, missing, expired };
    })
    .filter((c) => !(c.score.runs - c.score.passed >= GIVE_UP_FAILURES && c.score.score < MIN_SCORE));
  const scored = candidates.filter((c) => c.score.runs > 0).sort((a, b) => b.score.score - a.score.score || a.score.seconds - b.score.seconds);
  const unscored = candidates.filter((c) => c.score.runs === 0).sort((a, b) => b.model.created - a.model.created || a.model.id.localeCompare(b.model.id));
  const runs = (list: typeof candidates, pick: (c: (typeof candidates)[number]) => string[]) =>
    list.flatMap((c) => pick(c).map((scenario) => ({ model: c.model.id, scenario })));
  return [...runs(scored, (c) => c.missing), ...runs(scored, (c) => c.expired), ...runs(unscored, (c) => c.missing)];
}
