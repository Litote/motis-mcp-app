/**
 * Scores of the models in the evaluation (eval/README.md). model-scores.json keeps the last result of each scenario for
 * each model evaluated, written by `npm run eval`; the free model recommended, and its fallbacks, are chosen from them.
 */
import SCORES from "./model-scores.json";

/** Last result of a scenario for a model. */
export interface ScenarioResult {
  /** Every check passed. */
  ok: boolean;
  seconds: number;
  /** Day of the run, YYYY-MM-DD. */
  date: string;
}

/** Results per model, then per scenario id. */
export type ModelScores = Record<string, Record<string, ScenarioResult>>;

export interface ModelScore {
  model: string;
  passed: number;
  runs: number;
  /**
   * (passed + 1) / (runs + 2) (rule of succession): a model with few runs is not ranked above a model with many and a
   * few failures (1/1 scores 0.67, 15/16 scores 0.89).
   */
  score: number;
  /** Mean duration of a scenario. */
  seconds: number;
}

/** Score under which a model is neither recommended nor a fallback. */
export const MIN_SCORE = 0.5;

export function scoreOf(model: string, results: Record<string, ScenarioResult>): ModelScore {
  const all = Object.values(results);
  const passed = all.filter((r) => r.ok).length;
  const seconds = all.length ? all.reduce((sum, r) => sum + r.seconds, 0) / all.length : 0;
  return { model, passed, runs: all.length, score: (passed + 1) / (all.length + 2), seconds };
}

/** Models scoring at least [MIN_SCORE], best first: highest score, then fastest. */
export function rankModels(scores: ModelScores = SCORES as ModelScores): ModelScore[] {
  return Object.entries(scores)
    .map(([model, results]) => scoreOf(model, results))
    .filter((s) => s.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score || a.seconds - b.seconds || a.model.localeCompare(b.model));
}
