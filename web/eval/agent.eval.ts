/**
 * Evaluation of the agent of the web chat (src/agent.ts, unchanged) with real models and a real MCP server: each
 * scenario of scenarios.ts is sent to each model, and its tool calls and answer are checked. See eval/README.md.
 *
 * Environment: OPENROUTER_API_KEY (required, else skipped), EVAL_MODELS (comma-separated, default: the default model of
 * the chat), EVAL_MCP_URL (default http://localhost:3001/mcp), EVAL_SCENARIOS (comma-separated ids, default: all),
 * EVAL_DELAY_MS (pause between runs, for the rate limit of the free models).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ChatModelRunOptions, ChatModelRunResult, ThreadMessage } from "@assistant-ui/react";
import { evaluate, toRecord, type RunRecord, type Scenario } from "./checks";
import { report, type Run } from "./report";
import { SCENARIOS } from "./scenarios";

const env = process.env;
const key = env.OPENROUTER_API_KEY;
const mcpUrl = env.EVAL_MCP_URL ?? "http://localhost:3001/mcp";
const delayMs = Number(env.EVAL_DELAY_MS ?? 0);

vi.mock("../src/config", () => ({
  loadConfig: () => Promise.resolve({ mcpUrl: process.env.EVAL_MCP_URL ?? "http://localhost:3001/mcp", sandboxUrl: "", hostOrigins: [] }),
}));
// counts the model calls of each run
const streamChat = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../src/openrouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/openrouter")>();
  return {
    ...actual,
    streamChat: (...args: Parameters<typeof actual.streamChat>) => {
      streamChat.calls++;
      return actual.streamChat(...args);
    },
  };
});

const { createAgent } = await import("../src/agent");
const { DEFAULT_MODEL } = await import("../src/openrouter");

const models = (env.EVAL_MODELS ?? DEFAULT_MODEL).split(",").map((m) => m.trim()).filter(Boolean);
const only = env.EVAL_SCENARIOS?.split(",").map((s) => s.trim());
const scenarios = SCENARIOS.filter((s) => !only || only.includes(s.id));

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
  for (const model of models) {
    describe(model, () => {
      for (const scenario of scenarios) {
        it(`${scenario.id}: ${scenario.prompt}`, async () => {
          if (delayMs && runs.length) await new Promise((resolve) => setTimeout(resolve, delayMs));
          const start = Date.now();
          const record = await run(model, scenario);
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
    console.log(`Report: web/${name}.md`);
  });
});
