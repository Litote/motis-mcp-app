/**
 * Checks of an evaluation run: what the agent did (tool calls, answer) against what a scenario expects. Pure functions,
 * tested without a model (checks.test.ts).
 */
import type { ThreadAssistantMessagePart } from "@assistant-ui/react";

export type ToolArgs = Record<string, unknown>;

export interface ToolCallRecord {
  tool: string;
  args: ToolArgs;
  isError: boolean;
  /** Text of the result, for the report. */
  result: string;
}

/** What the agent did for one user message. */
export interface RunRecord {
  calls: ToolCallRecord[];
  /** Text after the last tool call: the answer read by the user. */
  answer: string;
  /** The agent ended normally (not stopped by its step limit, nor failed). */
  complete: boolean;
  /** Model calls. */
  steps: number;
  error?: string;
}

export interface Check<T> {
  label: string;
  check: (value: T) => boolean;
}

export interface Expectation {
  /** Tools to call, in this order (other calls may come between them). */
  tools: string[];
  /** Checks of the arguments of the first successful call of a tool (of the first call when all failed). */
  args?: (Check<ToolArgs> & { tool: string })[];
  answer?: Check<string>[];
  /** Tool errors expected (e.g. an ambiguous place): not counted as a failure. */
  allowToolErrors?: boolean;
  /** Maximum length of the answer: the views show the details, the model should not repeat them (default 1500). */
  maxAnswerChars?: number;
}

export interface Scenario {
  id: string;
  /** User message. */
  prompt: string;
  expect: Expectation;
}

export interface CheckResult {
  label: string;
  ok: boolean;
}

/** The record of a run from the parts of the answer of the agent. */
export function toRecord(
  parts: readonly ThreadAssistantMessagePart[],
  complete: boolean,
  steps: number,
  error?: string,
): RunRecord {
  const calls: ToolCallRecord[] = [];
  let answer = "";
  for (const part of parts) {
    if (part.type === "tool-call") {
      const result = part.result as { content?: { type: string; text?: string }[] } | undefined;
      calls.push({
        tool: part.toolName,
        args: (part.args ?? {}) as ToolArgs,
        isError: part.isError ?? false,
        result: (result?.content ?? []).map((c) => c.text ?? `[${c.type}]`).join("\n"),
      });
      answer = "";
    } else if (part.type === "text") {
      answer += part.text;
    }
  }
  return { calls, answer: answer.trim(), complete, steps, error };
}

/** [expected] is a subsequence of [actual]. */
export function inOrder(expected: string[], actual: string[]): boolean {
  let i = 0;
  for (const tool of actual) if (tool === expected[i]) i++;
  return i === expected.length;
}

export function evaluate(record: RunRecord, expectation: Expectation): CheckResult[] {
  const tools = record.calls.map((call) => call.tool);
  const results: CheckResult[] = [
    { label: "completed", ok: record.complete && !record.error },
    { label: "answered", ok: record.answer.length > 0 },
    { label: `tools ${expectation.tools.join(" → ")}`, ok: inOrder(expectation.tools, tools) },
  ];
  if (!expectation.allowToolErrors) {
    results.push({ label: "no tool error", ok: record.calls.every((call) => !call.isError) });
  }
  const maxChars = expectation.maxAnswerChars ?? 1500;
  results.push({ label: `answer ≤ ${maxChars} chars`, ok: record.answer.length <= maxChars });
  for (const { tool, label, check } of expectation.args ?? []) {
    const calls = record.calls.filter((call) => call.tool === tool);
    const call = calls.find((c) => !c.isError) ?? calls[0];
    results.push({ label: `${tool}: ${label}`, ok: call !== undefined && safely(() => check(call.args)) });
  }
  for (const { label, check } of expectation.answer ?? []) {
    results.push({ label: `answer: ${label}`, ok: safely(() => check(record.answer)) });
  }
  return results;
}

function safely(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}

/** `YYYY-MM-DDTHH:mm` of [date] in the time zone [tz]. */
export function localDateTime(date: Date, tz: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/**
 * `YYYY-MM-DDTHH:mm` in the time zone [tz] of a date-time argument of the tools: with an offset, converted; without,
 * already local (the server reads it in the local time of the place).
 */
export function argLocalDateTime(value: unknown, tz: string): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(" ", "T");
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : localDateTime(date, tz);
  }
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/.exec(text);
  return match ? match[1] : null;
}

/** Date (`YYYY-MM-DD`) of tomorrow in the time zone [tz]: the next calendar day (right on the days of a DST change). */
export function tomorrow(tz: string, now: Date = new Date()): string {
  const today = new Date(`${localDateTime(now, tz).slice(0, 10)}T12:00:00Z`);
  today.setUTCDate(today.getUTCDate() + 1);
  return today.toISOString().slice(0, 10);
}

/** Text of an argument, lower case, for the checks on place names. */
export function text(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : Array.isArray(value) ? value.join(",").toLowerCase() : "";
}
