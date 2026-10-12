import { describe, expect, it } from "vitest";
import type { ThreadAssistantMessagePart, ThreadMessage } from "@assistant-ui/react";
import { assistantMessages, parseArguments, setViewContext, systemPrompt, toChatMessages } from "./agent";

const result = (text: string) => ({ content: [{ type: "text", text }] });

describe("assistantMessages", () => {
  it("turns text, tool calls and the final answer into assistant + tool messages, in order", () => {
    const parts = [
      { type: "text", text: "Looking up." },
      { type: "tool-call", toolCallId: "c1", toolName: "departures", args: { stop: "Lyon" }, argsText: "", result: result("12:04 TER") },
      { type: "tool-call", toolCallId: "c2", toolName: "search_places", args: {}, argsText: "", result: result("Lyon Part-Dieu") },
      { type: "text", text: "Next train at 12:04." },
    ] as unknown as ThreadAssistantMessagePart[];

    expect(assistantMessages(parts)).toEqual([
      {
        role: "assistant",
        content: "Looking up.",
        tool_calls: [
          { id: "c1", type: "function", function: { name: "departures", arguments: '{"stop":"Lyon"}' } },
          { id: "c2", type: "function", function: { name: "search_places", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: "12:04 TER" },
      { role: "tool", tool_call_id: "c2", content: "Lyon Part-Dieu" },
      { role: "assistant", content: "Next train at 12:04." },
    ]);
  });

  it("gives an interrupted tool call a placeholder result, as every tool call needs one", () => {
    const parts = [
      { type: "tool-call", toolCallId: "c1", toolName: "departures", args: {}, argsText: "" },
    ] as unknown as ThreadAssistantMessagePart[];
    expect(assistantMessages(parts)[1]).toEqual({ role: "tool", tool_call_id: "c1", content: "No result (interrupted)." });
  });

  it("truncates long tool results", () => {
    const parts = [
      { type: "tool-call", toolCallId: "c1", toolName: "t", args: {}, argsText: "", result: result("x".repeat(20_000)) },
    ] as unknown as ThreadAssistantMessagePart[];
    const tool = assistantMessages(parts)[1] as { content: string };
    expect(tool.content.length).toBeLessThan(13_000);
    expect(tool.content.endsWith("[truncated]")).toBe(true);
  });
});

describe("toChatMessages", () => {
  it("keeps user text and converts assistant turns", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "Hi" }] },
      { role: "assistant", content: [{ type: "text", text: "Hello" }] },
    ] as unknown as ThreadMessage[];
    expect(toChatMessages(messages)).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
    ]);
  });
});

describe("parseArguments", () => {
  it("parses a JSON object, and falls back to {} on empty, invalid or non-object arguments", () => {
    expect(parseArguments('{"stop":"Lyon","count":3}')).toEqual({ stop: "Lyon", count: 3 });
    expect(parseArguments("")).toEqual({});
    expect(parseArguments('{"stop":')).toEqual({});
    expect(parseArguments("[1]")).toEqual({});
  });
});

describe("systemPrompt", () => {
  it("adds the date, and the context sent by the views", () => {
    setViewContext("c1", "Selected stop: Bellecour");
    const prompt = systemPrompt("Server instructions.", new Date("2026-10-10T08:00:00Z"));
    expect(prompt).toContain("Server instructions.");
    expect(prompt).toContain("2026-10-10T08:00:00.000Z");
    expect(prompt).toContain("Selected stop: Bellecour");
    setViewContext("c1", null);
    expect(systemPrompt("x")).not.toContain("Bellecour");
  });
});
