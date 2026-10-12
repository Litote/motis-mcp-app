/**
 * Agent loop run in the browser: the model (OpenRouter) asks for tool calls, they are executed on the MCP server, their
 * results go back to the model, until it answers. Each step is streamed to the thread as assistant-ui message parts;
 * the tool call parts carry the MCP result, rendered by the views (ToolCall.tsx).
 */
import type {
  ChatModelAdapter,
  ThreadAssistantMessagePart,
  ThreadMessage,
  ToolCallMessagePart,
} from "@assistant-ui/react";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { callTool, connectMcp, modelTools, resultText } from "./mcp";
import { streamChat, type ChatMessage, type ChatToolCall } from "./openrouter";

/** Model calls per user message: bounds the loop, and the consumption of the free quota (2 to 3 calls usually). */
const MAX_STEPS = 6;
/** Tool result size given back to the model. */
const MAX_RESULT_CHARS = 12_000;

export interface AgentSettings {
  key(): string | null;
  model(): string;
  /** Models tried by OpenRouter when the selected one fails. */
  fallbackModels(): string[];
  /** Called after each run (quota refresh). */
  onRunEnd?(): void;
}

/** Context sent by the views (ui/update-model-context), added to the system prompt. */
const viewContexts = new Map<string, string>();

export function setViewContext(toolCallId: string, text: string | null): void {
  if (text) viewContexts.set(toolCallId, text);
  else viewContexts.delete(toolCallId);
}

export function systemPrompt(instructions: string, now: Date = new Date()): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = [
    instructions,
    `Current date and time: ${now.toISOString()} (user time zone: ${timeZone}).`,
    "Interactive views (maps, departure boards, itineraries) are shown to the user below your tool calls, with every " +
      "result line. Do not reproduce these lists or tables: answer in a few sentences with the key facts (best " +
      "option, next times, transfers), the user reads the details in the views.",
    "Answer in the language of the latest user message, not in the language of the place names or of the tool results.",
  ];
  if (viewContexts.size) parts.push("Context from the views the user interacted with:\n" + [...viewContexts.values()].join("\n"));
  return parts.join("\n\n");
}

/** Arguments of a tool call part (JSON object). */
type ToolArgs = ToolCallMessagePart["args"];
type ToolPart = ToolCallMessagePart<ToolArgs, CallToolResult>;

/** Converts the thread history into chat messages: tool calls and their results included. */
export function toChatMessages(messages: readonly ThreadMessage[]): ChatMessage[] {
  const chat: ChatMessage[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      const text = message.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
      chat.push({ role: "user", content: text });
    } else if (message.role === "assistant") {
      chat.push(...assistantMessages(message.content));
    }
  }
  return chat;
}

/** An assistant turn: text and tool call parts, in order, become assistant(tool_calls) + tool messages. */
export function assistantMessages(parts: readonly ThreadAssistantMessagePart[]): ChatMessage[] {
  const chat: ChatMessage[] = [];
  let text = "";
  let calls: ToolPart[] = [];
  const flush = () => {
    if (calls.length) {
      chat.push({
        role: "assistant",
        content: text || null,
        tool_calls: calls.map((call) => ({
          id: call.toolCallId,
          type: "function",
          function: { name: call.toolName, arguments: JSON.stringify(call.args ?? {}) },
        })),
      });
      for (const call of calls) {
        chat.push({
          role: "tool",
          tool_call_id: call.toolCallId,
          content: call.result ? truncate(resultText(call.result)) : "No result (interrupted).",
        });
      }
    } else if (text) {
      chat.push({ role: "assistant", content: text });
    }
    text = "";
    calls = [];
  };
  for (const part of parts) {
    if (part.type === "text") {
      if (calls.length) flush();
      text += part.text;
    } else if (part.type === "tool-call") {
      calls.push(part as ToolPart);
    }
  }
  flush();
  return chat;
}

function truncate(text: string): string {
  return text.length > MAX_RESULT_CHARS ? text.slice(0, MAX_RESULT_CHARS) + "\n[truncated]" : text;
}

export function parseArguments(json: string): ToolArgs {
  if (!json.trim()) return {};
  try {
    const value = JSON.parse(json);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as ToolArgs) : {};
  } catch {
    return {};
  }
}

export function createAgent(settings: AgentSettings): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const key = settings.key();
      if (!key) throw new Error("Log in with OpenRouter first.");
      const mcp = await connectMcp();
      const tools = modelTools(mcp);
      const chat: ChatMessage[] = [{ role: "system", content: systemPrompt(mcp.instructions) }, ...toChatMessages(messages)];
      // Parts of the answer: completed steps, then the step being streamed
      const done: ThreadAssistantMessagePart[] = [];
      try {
        for (let step = 0; step < MAX_STEPS; step++) {
          let streamed: ThreadAssistantMessagePart[] = [];
          const parts = (text: string, calls: ChatToolCall[]): ThreadAssistantMessagePart[] => [
            ...(text ? [{ type: "text" as const, text }] : []),
            ...calls
              .filter((call) => call.function.name)
              .map((call, i) => ({
                type: "tool-call" as const,
                toolCallId: call.id || `call-${step}-${i}`,
                toolName: call.function.name,
                args: parseArguments(call.function.arguments),
                argsText: call.function.arguments,
              })),
          ];
          const updates: ThreadAssistantMessagePart[][] = [];
          let wake: (() => void) | undefined;
          let finished = false;
          const completion = streamChat(key, settings.model(), settings.fallbackModels(), chat, tools, abortSignal, (delta) => {
            updates.push(parts(delta.text, delta.toolCalls));
            wake?.();
          }).finally(() => {
            finished = true;
            wake?.();
          });
          // rejection handled by `await completion` below, once the deltas are yielded
          completion.catch(() => undefined);
          // Yields the streamed deltas as they arrive
          while (!finished || updates.length) {
            if (!updates.length) {
              await new Promise<void>((resolve) => (wake = resolve));
              wake = undefined;
              continue;
            }
            streamed = updates.splice(0).at(-1)!;
            yield { content: [...done, ...streamed] };
          }
          const result = await completion;
          const calls = result.toolCalls.filter((call) => call.function.name);
          if (!calls.length) {
            done.push(...parts(result.text, []));
            yield { content: done, status: { type: "complete", reason: "stop" } };
            return;
          }
          // Executes the tool calls, then gives their results back to the model
          const toolCalls = calls.map((call, i) => ({ ...call, id: call.id || `call-${step}-${i}` }));
          chat.push({ role: "assistant", content: result.text || null, tool_calls: toolCalls });
          const running = parts(result.text, toolCalls);
          yield { content: [...done, ...running] };
          const results = await Promise.all(
            toolCalls.map((call) => callTool(mcp, call.function.name, { ...parseArguments(call.function.arguments) })),
          );
          results.forEach((toolResult, i) => {
            chat.push({ role: "tool", tool_call_id: toolCalls[i].id, content: truncate(resultText(toolResult)) });
          });
          done.push(
            ...running.map((part) => {
              if (part.type !== "tool-call") return part;
              const i = toolCalls.findIndex((call) => call.id === part.toolCallId);
              return { ...part, result: results[i], isError: results[i]?.isError ?? false };
            }),
          );
          yield { content: done };
        }
        done.push({ type: "text", text: "\n\n_Stopped: too many steps for one question._" });
        yield { content: done, status: { type: "incomplete", reason: "other" } };
      } finally {
        settings.onRunEnd?.();
      }
    },
  };
}
