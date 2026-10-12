import { describe, expect, it } from "vitest";
import { applyDelta, recommendedPaidModels, sseData, type ChatDelta } from "./openrouter";

function stream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
}

describe("sseData", () => {
  it("yields the data payloads, across chunk boundaries, skipping comments", async () => {
    const payloads: string[] = [];
    for await (const data of sseData(stream([": OPENROUTER PROCESSING\n\ndata: {\"a\"", ":1}\n\ndata: [DONE]\n\n"]))) {
      payloads.push(data);
    }
    expect(payloads).toEqual(['{"a":1}', "[DONE]"]);
  });
});

describe("applyDelta", () => {
  it("appends text and merges tool call fragments by index", () => {
    const state: ChatDelta = { text: "", toolCalls: [] };
    applyDelta(state, { content: "Let me " });
    applyDelta(state, { content: "check." });
    applyDelta(state, { tool_calls: [{ index: 0, id: "c1", function: { name: "departures", arguments: '{"st' } }] });
    applyDelta(state, { tool_calls: [{ index: 0, function: { arguments: 'op":"Lyon"}' } }] });
    applyDelta(state, { tool_calls: [{ index: 1, id: "c2", function: { name: "rentals", arguments: "{}" } }] });
    applyDelta(state, undefined);

    expect(state.text).toBe("Let me check.");
    expect(state.toolCalls).toEqual([
      { id: "c1", type: "function", function: { name: "departures", arguments: '{"stop":"Lyon"}' } },
      { id: "c2", type: "function", function: { name: "rentals", arguments: "{}" } },
    ]);
  });
});

describe("recommendedPaidModels", () => {
  const day = 24 * 3600;
  const now = 2_000_000_000;
  const model = (id: string, name: string, created = now, free = false) => ({ id, name, created, free });

  it("keeps the latest aliases and the most recent general models of the major providers", () => {
    const openai = Array.from({ length: 8 }, (_, i) => model(`openai/gpt-6.${i}`, `OpenAI: GPT-6.${i}`, now - i * day));
    const models = [
      ...openai,
      model("anthropic/claude-sonnet-5.5", "Anthropic: Claude Sonnet 5.5"),
      model("anthropic/claude-sonnet-5.5:batch", "Anthropic: Claude Sonnet 5.5 (batch)"),
      model("~anthropic/claude-sonnet-latest", "Anthropic: Claude Sonnet Latest", now - 900 * day),
      model("google/gemini-3.1-pro-preview", "Google: Gemini 3.1 Pro Preview"),
      model("openai/gpt-audio", "OpenAI: GPT Audio"),
      model("meta-llama/llama-3.1-8b-instruct", "Meta: Llama 3.1 8B Instruct", now - 900 * day),
      model("moonshotai/kimi-k2.7-code", "MoonshotAI: Kimi K2.7 Code"),
      model("aion-labs/aion-3.5", "AionLabs: Aion 3.5"),
      model("nvidia/nemotron-3-super-120b-a12b:free", "NVIDIA: Nemotron 3 Super (free)", now, true),
    ];
    expect(recommendedPaidModels(models).map((m) => m.id)).toEqual([
      "~anthropic/claude-sonnet-latest",
      "anthropic/claude-sonnet-5.5",
      "openai/gpt-6.0",
      "openai/gpt-6.1",
      "openai/gpt-6.2",
      "openai/gpt-6.3",
      "openai/gpt-6.4",
    ]);
  });
});
