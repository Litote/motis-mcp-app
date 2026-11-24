/**
 * Evaluation of the agent of the web chat (src/agent.ts, unchanged) with real models and a real MCP server: each
 * scenario of scenarios.ts is sent to each model, and its tool calls and answer are checked. See eval/README.md.
 *
 * The results update the scores of the models (src/model-scores.json), from which the chat chooses its free model.
 *
 * Environment: OPENROUTER_API_KEY (required, else skipped), EVAL_MODELS (comma-separated, default: the recommended
 * model of the chat), EVAL_MCP_URL (default http://localhost:3001/mcp), EVAL_SCENARIOS (comma-separated ids, default: all),
 * EVAL_DELAY_MS (pause between runs, for the rate limit of the free models), EVAL_MAX_CALLS (model calls at most,
 * default: no limit), EVAL_AUTO=1 (the scenarios without result of the free models listed by OpenRouter, plan.ts, instead
 * of EVAL_MODELS and EVAL_SCENARIOS: the daily evaluation of .github/workflows/model-scores.yml).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ChatModelRunOptions, ChatModelRunResult, ThreadMessage } from "@assistant-ui/react";
import { evaluate, toRecord, type RunRecord, type Scenario } from "./checks";
import { planEvaluation, type PlannedRun } from "./plan";
import { report, type Run } from "./report";
import { SCENARIOS } from "./scenarios";
import { mergeScores } from "./scores";

const env = process.env;
const key = env.OPENROUTER_API_KEY;
const mcpUrl = env.EVAL_MCP_URL ?? "http://localhost:3001/mcp";
const delayMs = Number(env.EVAL_DELAY_MS ?? 0);
const maxCalls = Number(env.EVAL_MAX_CALLS ?? Infinity);
const auto = env.EVAL_AUTO === "1";
const SCORES_FILE = "src/model-scores.json";
/** Model calls of a scenario, usually: none is started with fewer calls left (EVAL_MAX_CALLS). */
const CALLS_PER_SCENARIO = 4;
/** Errors in a row (rate limited…) after which the runs of a model are skipped: they would consume calls for nothing. */
const MAX_ERRORS_IN_A_ROW = 2;

vi.mock("../src/config", () => ({
  loadConfig: () => Promise.resolve({ mcpUrl: process.env.EVAL_MCP_URL ?? "http://localhost:3001/mcp", sandboxUrl: "", hostOrigins: [] }),
}));
// Node has no window: the chat completions send its origin as HTTP-Referer
vi.stubGlobal("window", { location: new URL("http://localhost:5173/") });
// counts the model calls of each run
const streamChat = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../src/openrouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/openrouter")>();
  return {
    ...actual,
    streamChat: (...args: Parameters<typeof actual.streamChat>) => {
      // the run ends with an error, not counted in the scores
      if (streamChat.calls >= Number(process.env.EVAL_MAX_CALLS ?? Infinity)) return Promise.reject(new Error("EVAL_MAX_CALLS reached"));
      streamChat.calls++;
      return actual.streamChat(...args);
    },
  };
});

const { createAgent } = await import("../src/agent");
const { listModels, recommendedModel } = await import("../src/openrouter");

/** Runs of EVAL_MODELS × EVAL_SCENARIOS, or planned (EVAL_AUTO): at least 2 model calls per scenario. */
async function plannedRuns(): Promise<PlannedRun[]> {
  if (auto) {
    const scores = JSON.parse(readFileSync(SCORES_FILE, "utf8"));
    return planEvaluation(await listModels(), scores, SCENARIOS.map((s) => s.id), Math.floor(maxCalls / 2));
  }
  const models = (env.EVAL_MODELS ?? recommendedModel([])).split(",").map((m) => m.trim()).filter(Boolean);
  const only = env.EVAL_SCENARIOS?.split(",").map((s) => s.trim());
  const scenarios = SCENARIOS.filter((s) => !only || only.includes(s.id));
  return models.flatMap((model) => scenarios.map((s) => ({ model, scenario: s.id })));
}

const planned = key ? await plannedRuns() : [];
const byModel = new Map<string, PlannedRun[]>();
for (const p of planned) byModel.set(p.model, [...(byModel.get(p.model) ?? []), p]);
const errorsInARow = new Map<string, number>();

const runs: Run[] = [];

async function run(model: string, scenario: Scenario): Promise<RunRecord> {
  const agent = createAgent({ key: () => key ?? null, model: () => model, fallbackModels: () => [] });
  const message = { role: "user", content: [{ type: "text", text: scenario.prompt }] } as unknown as ThreadMessage;
  const options = { messages: [message], abortSignal: new AbortController().signal } as unknown as ChatModelRunOptions;
  const before = streamChat.calls;
  let last: ChatModelRunResult | undefined;
  try {
    for await (const result of agent.run(options) as AsyncGenerator<ChatModelRunResult>) last = result;
    return toRecord(last?.content ?? [], last?.status?.type === "complete", streamChat.calls - before);
  } catch (e) {
    return toRecord(last?.content ?? [], false, streamChat.calls - before, e instanceof Error ? e.message : String(e));
  }
}

describe.skipIf(!key)(`agent evaluation (MCP server ${mcpUrl})`, () => {
  if (!planned.length) it.skip("nothing to evaluate: every free model listed is evaluated", () => {});
  for (const [model, modelRuns] of byModel) {
    describe(model, () => {
      for (const scenario of modelRuns.map((p) => SCENARIOS.find((s) => s.id === p.scenario)!)) {
        it(`${scenario.id}: ${scenario.prompt}`, async ({ skip }) => {
          if (maxCalls - streamChat.calls < CALLS_PER_SCENARIO) skip("EVAL_MAX_CALLS reached");
          if ((errorsInARow.get(model) ?? 0) >= MAX_ERRORS_IN_A_ROW) skip(`${MAX_ERRORS_IN_A_ROW} errors in a row`);
          if (delayMs && runs.length) await new Promise((resolve) => setTimeout(resolve, delayMs));
          const start = Date.now();
          const record = await run(model, scenario);
          errorsInARow.set(model, record.error ? (errorsInARow.get(model) ?? 0) + 1 : 0);
          const checks = evaluate(record, scenario.expect);
          runs.push({ model, scenario, record, checks, seconds: (Date.now() - start) / 1000 });
          for (const check of checks) expect.soft(check.ok, check.label).toBe(true);
        });
      }
    });
  }

  afterAll(() => {
    if (!runs.length) return;
    mkdirSync("eval/results", { recursive: true });
    const name = `eval/results/${new Date().toISOString().replaceAll(":", "-").slice(0, 19)}`;
    writeFileSync(`${name}.json`, JSON.stringify(runs.map(({ scenario, ...run }) => ({ ...run, scenario: scenario.id })), null, 2));
    writeFileSync(`${name}.md`, report(runs, mcpUrl));
    console.log(`Report: web/${name}.md (${streamChat.calls} model calls)`);
    const scores = JSON.parse(readFileSync(SCORES_FILE, "utf8"));
    const date = new Date().toLocaleDateString("sv"); // YYYY-MM-DD, local
    writeFileSync(SCORES_FILE, `${JSON.stringify(mergeScores(scores, runs, date, SCENARIOS.map((s) => s.id)), null, 2)}\n`);
    console.log(`Scores: web/${SCORES_FILE}`);
  });
});
