import { describe, expect, it } from "vitest";
import type { ThreadAssistantMessagePart } from "@assistant-ui/react";
import { argLocalDateTime, evaluate, inOrder, localDateTime, tomorrow, toRecord, type RunRecord } from "./checks";
import { SCENARIOS } from "./scenarios";

const record = (overrides: Partial<RunRecord> = {}): RunRecord => ({
  calls: [{ tool: "departures", args: { stop: "Lyon Part-Dieu" }, isError: false, result: "ok" }],
  answer: "Next train at 12:04.",
  complete: true,
  steps: 2,
  ...overrides,
});

const failed = (r: RunRecord, expectation: Parameters<typeof evaluate>[1]) =>
  evaluate(r, expectation)
    .filter((c) => !c.ok)
    .map((c) => c.label);

describe("evaluation checks", () => {
  it("records the tool calls and the answer after the last of them", () => {
    const parts = [
      { type: "text", text: "Checking." },
      {
        type: "tool-call",
        toolName: "departures",
        args: { stop: "Lyon" },
        isError: false,
        result: { content: [{ type: "text", text: "12:04 TER" }] },
      },
      { type: "text", text: "Next train " },
      { type: "text", text: "at 12:04." },
    ] as unknown as ThreadAssistantMessagePart[];

    expect(toRecord(parts, true, 2)).toEqual({
      calls: [{ tool: "departures", args: { stop: "Lyon" }, isError: false, result: "12:04 TER" }],
      answer: "Next train at 12:04.",
      complete: true,
      steps: 2,
      error: undefined,
    });
  });

  it("expects the tools in order, other calls between them allowed", () => {
    expect(inOrder(["explore_area", "route_details"], ["search_places", "explore_area", "route_details"])).toBe(true);
    expect(inOrder(["explore_area", "route_details"], ["route_details", "explore_area"])).toBe(false);
    expect(inOrder([], [])).toBe(true);
  });

  it("passes a run doing what is expected", () => {
    expect(failed(record(), { tools: ["departures"], args: [{ tool: "departures", label: "Lyon", check: (a) => a.stop === "Lyon Part-Dieu" }] })).toEqual([]);
  });

  it("reports what a run missed", () => {
    const r = record({
      calls: [{ tool: "departures", args: {}, isError: true, result: "Invalid argument" }],
      answer: "x".repeat(2000),
      complete: false,
    });

    expect(failed(r, { tools: ["plan_journey"], answer: [{ label: "says when", check: (a) => a.includes(":") }] })).toEqual([
      "completed",
      "tools plan_journey",
      "no tool error",
      "answer ≤ 1500 chars",
      "answer: says when",
    ]);
    // a tool never called fails its argument checks; tool errors can be expected
    expect(failed(r, { tools: [], allowToolErrors: true, maxAnswerChars: 5000, args: [{ tool: "rentals", label: "place", check: () => true }] })).toEqual([
      "completed",
      "rentals: place",
    ]);
  });

  it("checks the arguments of the first successful call", () => {
    const r = record({
      calls: [
        { tool: "departures", args: { stop: "Saint-Michel" }, isError: true, result: "ambiguous" },
        { tool: "departures", args: { stopId: "bordeaux" }, isError: false, result: "ok" },
      ],
    });

    expect(failed(r, { tools: ["departures"], allowToolErrors: true, args: [{ tool: "departures", label: "id", check: (a) => a.stopId === "bordeaux" }] })).toEqual([]);
  });

  it("reads the date-times of the arguments in the time zone of the place", () => {
    expect(argLocalDateTime("2026-10-17T08:00", "Europe/Paris")).toBe("2026-10-17T08:00");
    expect(argLocalDateTime("2026-10-17 08:00:00", "Europe/Paris")).toBe("2026-10-17T08:00");
    expect(argLocalDateTime("2026-10-17T06:00:00Z", "Europe/Paris")).toBe("2026-10-17T08:00");
    expect(argLocalDateTime("2026-10-17T08:00:00+02:00", "Europe/Paris")).toBe("2026-10-17T08:00");
    expect(argLocalDateTime("tomorrow", "Europe/Paris")).toBeNull();
    expect(argLocalDateTime(undefined, "Europe/Paris")).toBeNull();
  });

  it("gives tomorrow in the time zone, DST changes included", () => {
    // 2026-10-25: 25 hours in Paris
    expect(tomorrow("Europe/Paris", new Date("2026-10-24T22:30:00Z"))).toBe("2026-10-26");
    expect(tomorrow("Europe/Paris", new Date("2026-10-24T21:30:00Z"))).toBe("2026-10-25");
    expect(localDateTime(new Date("2026-10-24T21:30:00Z"), "Europe/Paris")).toBe("2026-10-24T23:30");
  });
});

describe("scenarios", () => {
  it("have distinct ids, and cover every tool of the server", () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const tools = new Set(SCENARIOS.flatMap((s) => s.expect.tools));
    for (const tool of ["search_places", "server_info", "explore_area", "route_details", "reachability", "departures", "trip_details", "plan_journey", "rentals"]) {
      expect(tools, tool).toContain(tool);
    }
  });
});

describe("report", () => {
  it("tabulates the scenarios per model, then details the failed runs", async () => {
    const { report } = await import("./report");
    const scenario = SCENARIOS[0];
    const ok = record();
    const ko = record({ calls: [{ tool: "departures", args: { stop: "X" }, isError: true, result: "No place found\nmore" }], answer: "" });
    const text = report(
      [
        { model: "a", scenario, record: ok, checks: evaluate(ok, scenario.expect), seconds: 4.2 },
        { model: "b", scenario, record: ko, checks: evaluate(ko, scenario.expect), seconds: 9 },
      ],
      "http://localhost:3001/mcp",
      new Date("2026-10-16T21:00:00Z"),
    );

    expect(text).toContain("# Agent evaluation — 2026-10-16T21:00");
    expect(text).toContain("| Scenario | a | b |");
    expect(text).toContain("| departures | ✓ 6/6 · 2 steps · 4 s | ✗ 3/6 · 2 steps · 9 s |");
    expect(text).toContain("| **Total** | **1/1 scenarios** | **0/1 scenarios** |");
    expect(text).toContain("## ✗ departures — b");
    expect(text).toContain('- ✗ `departures` `{"stop":"X"}` → No place found');
    expect(text).toContain("> (none)");
    expect(text).not.toContain("## ✗ departures — a");
  });
});
