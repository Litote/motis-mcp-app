import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatModelRunOptions, ChatModelRunResult, ThreadMessage } from "@assistant-ui/react";
import type { ChatDelta } from "./openrouter";

const mcp = vi.hoisted(() => ({
  connectMcp: vi.fn(),
  callTool: vi.fn(),
}));
const openrouter = vi.hoisted(() => ({ streamChat: vi.fn() }));

vi.mock("./mcp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./mcp")>()),
  connectMcp: mcp.connectMcp,
  callTool: mcp.callTool,
}));
vi.mock("./openrouter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./openrouter")>()),
  streamChat: openrouter.streamChat,
}));

const { createAgent } = await import("./agent");

const server = {
  instructions: "MOTIS server.",
  tools: new Map([["departures", { name: "departures", description: "Departures", inputSchema: { type: "object" } }]]),
  resources: new Map(),
};

const userMessage = { role: "user", content: [{ type: "text", text: "Next train?" }] } as unknown as ThreadMessage;

/** streamChat answering [delta] after streaming it. */
function answer(delta: ChatDelta) {
  return async (...args: unknown[]) => {
    const onDelta = args[3] as (delta: ChatDelta) => void;
    onDelta({ text: delta.text, toolCalls: [] });
    onDelta(delta);
    return delta;
  };
}

async function run(settings: Parameters<typeof createAgent>[0]): Promise<ChatModelRunResult[]> {
  const options = { messages: [userMessage], abortSignal: new AbortController().signal } as unknown as ChatModelRunOptions;
  const results: ChatModelRunResult[] = [];
  for await (const result of createAgent(settings).run(options) as AsyncGenerator<ChatModelRunResult>) results.push(result);
  return results;
}

const settings = (onRunEnd = vi.fn()) => ({
  key: () => "sk-or-v1-key",
  model: () => "model",
  fallbackModels: () => ["fallback"],
  onRunEnd,
});

afterEach(() => vi.resetAllMocks());

describe("createAgent", () => {
  it("stops after the tool calls when the user stops the run", async () => {
    const controller = new AbortController();
    mcp.connectMcp.mockResolvedValue(server);
    mcp.callTool.mockImplementation(async () => {
      controller.abort();
      return { content: [{ type: "text", text: "cancelled" }], isError: true };
    });
    openrouter.streamChat.mockImplementationOnce(
      answer({ text: "", toolCalls: [{ id: "c1", type: "function", function: { name: "departures", arguments: "{}" } }] }),
    );
    const onRunEnd = vi.fn();
    const options = { messages: [userMessage], abortSignal: controller.signal } as unknown as ChatModelRunOptions;
    const results: ChatModelRunResult[] = [];

    await expect(async () => {
      for await (const result of createAgent(settings(onRunEnd)).run(options) as AsyncGenerator<ChatModelRunResult>) results.push(result);
    }).rejects.toThrow();

    expect(mcp.callTool).toHaveBeenCalledWith(server, "departures", {}, controller.signal);
    expect(openrouter.streamChat).toHaveBeenCalledTimes(1);
    // the tool call is shown with its result before stopping
    expect(results.at(-1)!.content).toEqual([expect.objectContaining({ type: "tool-call", toolCallId: "c1", isError: true })]);
    expect(onRunEnd).toHaveBeenCalled();
  });

  it("calls the tools asked by the model, then streams its answer", async () => {
    mcp.connectMcp.mockResolvedValue(server);
    mcp.callTool.mockResolvedValue({ content: [{ type: "text", text: "12:04 TER" }] });
    openrouter.streamChat
      .mockImplementationOnce(
        answer({
          text: "Checking.",
          toolCalls: [{ id: "", type: "function", function: { name: "departures", arguments: '{"stop":"Lyon"}' } }],
          model: "model",
        }),
      )
      .mockImplementationOnce(answer({ text: "Next train at 12:04.", toolCalls: [], model: "fallback" }));
    const onRunEnd = vi.fn();

    const results = await run(settings(onRunEnd));

    expect(mcp.callTool).toHaveBeenCalledWith(server, "departures", { stop: "Lyon" }, expect.any(AbortSignal));
    const last = results.at(-1)!;
    expect(last.status).toEqual({ type: "complete", reason: "stop" });
    // the models that answered, each once
    expect(last.metadata).toEqual({ custom: { models: ["model", "fallback"] } });
    expect(last.content).toEqual([
      { type: "text", text: "Checking." },
      expect.objectContaining({ type: "tool-call", toolCallId: "call-0-0", toolName: "departures", isError: false }),
      { type: "text", text: "Next train at 12:04." },
    ]);
    // the second model call gets the tool result
    const chat = openrouter.streamChat.mock.calls[1][1].messages;
    expect(chat.at(-1)).toEqual({ role: "tool", tool_call_id: "call-0-0", content: "12:04 TER" });
    expect(chat[0].content).toContain("MOTIS server.");
    expect(openrouter.streamChat.mock.calls[0][1]).toMatchObject({ model: "model", fallbackModels: ["fallback"] });
    expect(onRunEnd).toHaveBeenCalledOnce();
  });

  it("stops after too many steps", async () => {
    mcp.connectMcp.mockResolvedValue(server);
    mcp.callTool.mockResolvedValue({ content: [{ type: "text", text: "x".repeat(20_000) }] });
    openrouter.streamChat.mockImplementation(
      answer({ text: "", toolCalls: [{ id: "c", type: "function", function: { name: "departures", arguments: "" } }] }),
    );

    const results = await run(settings());

    expect(openrouter.streamChat).toHaveBeenCalledTimes(6);
    // the last call is made without tools nor tool messages; tool calls asked for anyway are neither shown nor run
    expect(mcp.callTool).toHaveBeenCalledTimes(5);
    expect(openrouter.streamChat.mock.calls[4][1].tools).toHaveLength(1);
    expect(openrouter.streamChat.mock.calls[5][1].tools).toEqual([]);
    const chat = openrouter.streamChat.mock.calls[5][1].messages;
    expect(chat[0].content).toContain("No more tool calls are possible");
    expect(openrouter.streamChat.mock.calls[4][1].messages[0].content).not.toContain("No more tool calls are possible");
    expect(chat.filter((m: { role: string }) => m.role === "tool")).toEqual([]);
    expect(chat.at(-1)).toMatchObject({ role: "user", content: expect.stringMatching(/^\[tool result] departures:\n.*\[truncated]$/s) });
    const last = results.at(-1)!;
    expect(last.status).toEqual({ type: "incomplete", reason: "other" });
    expect(last.content!.filter((part) => part.type === "tool-call")).toHaveLength(5);
    expect(last.content!.at(-1)).toEqual({ type: "text", text: "\n\n_Stopped: too many steps for one question._" });
  });

  it("answers with the results already there at the last step", async () => {
    mcp.connectMcp.mockResolvedValue(server);
    mcp.callTool.mockResolvedValue({ content: [{ type: "text", text: "\"Versailles\" is ambiguous" }] });
    const toolCall = answer({ text: "", toolCalls: [{ id: "c", type: "function", function: { name: "departures", arguments: "" } }] });
    openrouter.streamChat.mockImplementation((...args: unknown[]) =>
      (args[1] as { tools: unknown[] }).tools.length === 0 ? answer({ text: "Which Versailles?", toolCalls: [] })(...args) : toolCall(...args),
    );

    const results = await run(settings());

    expect(openrouter.streamChat).toHaveBeenCalledTimes(6);
    const last = results.at(-1)!;
    expect(last.status).toEqual({ type: "complete", reason: "stop" });
    expect(last.content!.at(-1)).toEqual({ type: "text", text: "Which Versailles?" });
  });

  it("reports the model errors", async () => {
    mcp.connectMcp.mockResolvedValue(server);
    openrouter.streamChat.mockRejectedValue(new Error("quota"));
    const onRunEnd = vi.fn();

    await expect(run(settings(onRunEnd))).rejects.toThrow("quota");
    expect(onRunEnd).toHaveBeenCalledOnce();
  });

  it("requires a key", async () => {
    await expect(run({ ...settings(), key: () => null })).rejects.toThrow("Log in with OpenRouter first.");
  });
});
