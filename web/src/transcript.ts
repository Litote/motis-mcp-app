/**
 * Export of the conversation as Markdown, to paste in the description of a bug: the context (page, model, locale,
 * browser), then the messages, with the tool calls (arguments and result) folded in `<details>` (GitHub) and the
 * models that answered.
 */
import type { ThreadMessage } from "@assistant-ui/react";
import type { CallToolResult } from "@modelcontextprotocol/client";

/** Size of a tool result in the export: a GitHub issue body is limited to 65,536 characters. */
export const MAX_EXPORTED_RESULT_CHARS = 2000;

export interface TranscriptContext {
  /** Page of the chat, without query nor fragment (the OAuth code of the login is in the query). */
  page: string;
  model: string;
  locale: string;
  userAgent: string;
  date: Date;
}

/** Code block of [text], with a fence longer than any backtick run of the text. */
function codeBlock(text: string, language = ""): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${text}\n${fence}`;
}

function truncate(text: string): string {
  if (text.length <= MAX_EXPORTED_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_EXPORTED_RESULT_CHARS)}\n[… ${text.length - MAX_EXPORTED_RESULT_CHARS} characters truncated]`;
}

function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

type MessagePart = ThreadMessage["content"][number];

function toolCall(part: Extract<MessagePart, { type: "tool-call" }>): string {
  const result = part.result as CallToolResult | undefined;
  let state = "";
  if (result === undefined) state = " (no result)";
  else if (part.isError) state = " (error)";
  const args = part.argsText?.trim() ? part.argsText : jsonText(part.args ?? {});
  const lines = [`<details><summary>Tool <code>${part.toolName}</code>${state}</summary>`, "", "Arguments:", "", codeBlock(args, "json")];
  if (result !== undefined) {
    const text = result.content?.length
      ? result.content.map((content) => (content.type === "text" ? content.text : `[${content.type}]`)).join("\n")
      : jsonText(result.structuredContent ?? result);
    lines.push("", "Result:", "", codeBlock(truncate(text)));
  }
  lines.push("", "</details>");
  return lines.join("\n");
}

function part(content: MessagePart): string | null {
  switch (content.type) {
    case "text":
      return content.text.trim() ? content.text : null;
    case "tool-call":
      return toolCall(content);
    default:
      return `[${content.type}]`;
  }
}

/** End of an assistant message that did not complete: still running, stopped, or failed (with the error). */
function status(message: ThreadMessage): string | null {
  if (message.role !== "assistant") return null;
  const { status } = message;
  if (status.type === "running") return "_(still running at the export)_";
  if (status.type !== "incomplete") return null;
  if (status.reason === "cancelled") return "_(stopped by the user)_";
  let error = "";
  if (typeof status.error === "string") error = `: ${status.error}`;
  else if (status.error !== undefined) error = `: ${jsonText(status.error)}`;
  return `> **Incomplete (${status.reason})**${error.replaceAll("\n", "\n> ")}`;
}

/** Models that answered an assistant message (the selected one, or fallback ones). */
function models(message: ThreadMessage): string | null {
  const value = message.role === "assistant" ? message.metadata?.custom?.models : undefined;
  return Array.isArray(value) && value.length ? `_Models: ${value.map((model) => `\`${model}\``).join(" → ")}_` : null;
}

function message(message: ThreadMessage): string {
  const title = message.role === "user" ? "User" : "Assistant";
  const body = [...message.content.map(part), status(message), models(message)].filter((text): text is string => text !== null);
  return [`### ${title}`, "", body.join("\n\n") || "_(empty)_"].join("\n");
}

/** The conversation [messages] in Markdown, after its [context]. */
export function transcript(messages: readonly ThreadMessage[], context: TranscriptContext): string {
  return [
    "## Context",
    "",
    `- Page: ${context.page}`,
    `- Model: \`${context.model}\``,
    `- Locale: ${context.locale}`,
    `- Browser: ${context.userAgent}`,
    `- Exported: ${context.date.toISOString()}`,
    "",
    "## Conversation",
    "",
    ...messages.filter((m) => m.role !== "system").map((m) => `${message(m)}\n`),
  ]
    .join("\n")
    .trimEnd()
    .concat("\n");
}

/**
 * Copies [text] to the clipboard, else (clipboard unavailable or refused) downloads it as `conversation.md`.
 * Returns whether it was copied.
 */
export async function copyOrDownload(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: "conversation.md" });
    link.click();
    URL.revokeObjectURL(url);
    return false;
  }
}
