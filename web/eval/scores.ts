/** Scores of the models (src/model-scores.json), updated with the runs of an evaluation. Pure, tested in scores.test.ts. */
import type { ModelScores } from "../src/modelScores";
import type { Run } from "./report";

/**
 * [scores] with the results of [runs] (day [date]), which replace the previous result of the same model and scenario.
 * A run ended by an error (rate limited, model no longer free…) measured nothing: it is left out. Results of scenarios
 * no longer in [scenarioIds] are removed. Keys are sorted, for readable diffs.
 */
export function mergeScores(scores: ModelScores, runs: readonly Run[], date: string, scenarioIds: readonly string[]): ModelScores {
  const merged: ModelScores = structuredClone(scores);
  for (const run of runs) {
    if (run.record.error) continue;
    (merged[run.model] ??= {})[run.scenario.id] = {
      ok: run.checks.every((c) => c.ok),
      seconds: Math.round(run.seconds * 10) / 10,
      date,
    };
  }
  const known = new Set(scenarioIds);
  const sorted = <T>(entries: [string, T][]) => Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));
  return sorted(
    Object.entries(merged)
      .map(([model, results]) => [model, sorted(Object.entries(results).filter(([id]) => known.has(id)))] as [string, ModelScores[string]])
      .filter(([, results]) => Object.keys(results).length > 0),
  );
}
