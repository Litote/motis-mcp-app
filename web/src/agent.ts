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
import { t } from "./i18n";
import { currentPosition, formatPosition, type UserPosition } from "./location";
import { streamChat, type ChatDelta, type ChatMessage, type ChatToolCall } from "./openrouter";

/**
 * Model calls per user message: bounds the loop, and the consumption of the free quota (2 to 3 calls usually). The last
 * one is made without tools, for an answer with the results already there (see [withoutToolCalls]).
 */
const MAX_STEPS = 6;
/** Added to the system prompt of the last model call. */
const LAST_STEP_INSTRUCTION =
  "No more tool calls are possible for this question: answer now with the results above. If they are not enough, " +
  "say briefly what is missing or ask the user to be more precise.";
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

export function systemPrompt(
  instructions: string,
  now: Date = new Date(),
  position: UserPosition | null = currentPosition(),
): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = [
    instructions,
    `Current date and time: ${now.toISOString()} (user time zone: ${timeZone}).`,
    "Interactive views (maps, departure boards, itineraries) are shown to the user below your tool calls, with every " +
      "result line. Do not reproduce these lists or tables: answer in a few sentences with the key facts (best " +
      "option, next times, transfers), the user reads the details in the views.",
    "Answer in the language of the latest user message, not in the language of the place names or of the tool results.",
    "Pass that language (ISO 639-1 code, e.g. fr) as the 'language' argument of the tools: the names of the stations are " +
      "then given in it (fr, es, en, nl, de, it), e.g. Gérone and not Girona for a French user.",
  ];
  if (position) {
    parts.push(
      `Current position of the user: ${formatPosition(position)} (accuracy ${Math.round(position.accuracy)} m). ` +
        "When the user gives no origin or says 'here', 'near me': pass it as 'position' to plan_journey (without " +
        "'from'), or as 'lat,lon' place of the other tools.",
    );
  }
  if (viewContexts.size) parts.push("Context from the views the user interacted with:\n" + [...viewContexts.values()].join("\n"));
  return parts.join("\n\n");
}

/**
 * [chat] without tool calls, for a model call without tools: the tool calls and their results become text (assistant
 * and user messages), as the providers refuse tool messages without tools, and some ignore `tool_choice: "none"`.
 */
export function withoutToolCalls(chat: readonly ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  const names = new Map<string, string>();
  for (const message of chat) {
    if (message.role === "assistant" && message.tool_calls?.length) {
      const calls = message.tool_calls.map((call) => {
        names.set(call.id, call.function.name);
        return `[tool call] ${call.function.name} ${call.function.arguments || "{}"}`;
      });
      result.push({ role: "assistant", content: [message.content, ...calls].filter(Boolean).join("\n") });
    } else if (message.role === "tool") {
      const text = `[tool result] ${names.get(message.tool_call_id) ?? "tool"}:\n${message.content}`;
      // the results of one step: a single user message
      const previous = result.at(-1);
      if (previous?.role === "user" && previous.content.startsWith("[tool result]")) previous.content += `\n\n${text}`;
      else result.push({ role: "user", content: text });
    } else {
      result.push({ ...message });
    }
  }
  return result;
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

/** The model [requested], when one of the [fallbacks] answered instead of it (among the [answered] models). */
function fallbackFrom(answered: readonly string[], requested: string, fallbacks: readonly string[]): string | undefined {
  return answered.some((m) => m !== requested && fallbacks.includes(m)) ? requested : undefined;
}

/** Adds a notice to [parts] when they have no text to show (e.g. reasoning only, or a stream closed by the provider). */
function noAnswerNotice(parts: ThreadAssistantMessagePart[]): void {
  if (!parts.some((part) => part.type === "text" && part.text.trim())) {
    parts.push({ type: "text", text: `_${t("agent.emptyAnswer")}_` });
  }
}

export function createAgent(settings: AgentSettings): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const key = settings.key();
      if (!key) throw new Error(t("error.logInFirst"));
      const mcp = await connectMcp();
      const tools = modelTools(mcp);
      const chat: ChatMessage[] = [{ role: "system", content: systemPrompt(mcp.instructions) }, ...toChatMessages(messages)];
      // Parts of the answer: completed steps, then the step being streamed
      const done: ThreadAssistantMessagePart[] = [];
      // models that answered (fallback ones included), shown with the message
      const models: string[] = [];
      const requested = settings.model();
      const fallbacks = settings.fallbackModels();
      // set when a fallback model answered instead of the selected one: the chat says so
      const metadata = () => ({ custom: { models: [...models], fallbackFrom: fallbackFrom(models, requested, fallbacks) } });
      const addModel = (model: string | undefined) => {
        if (model && !models.includes(model)) models.push(model);
      };
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
          const last = step === MAX_STEPS - 1;
          const stepChat = last
            ? withoutToolCalls([{ ...chat[0], content: `${chat[0].content}\n\n${LAST_STEP_INSTRUCTION}` }, ...chat.slice(1)])
            : chat;
          const onDelta = (delta: ChatDelta) => {
            addModel(delta.model);
            updates.push(parts(delta.text, last ? [] : delta.toolCalls));
            wake?.();
          };
          const request = {
            model: settings.model(),
            fallbackModels: settings.fallbackModels(),
            messages: stepChat,
            tools: last ? [] : tools,
          };
          const completion = streamChat(key, request, abortSignal, onDelta).finally(() => {
            finished = true;
            wake?.();
          });
          // rejection handled by `await completion` below, once the deltas are yielded
          completion.catch(() => undefined);
          // Yields the streamed deltas as they arrive
          while (!finished || updates.length) {
            if (!updates.length) {
              await new Promise<void>((resolve) => (wake = resolve)); // NOSONAR waits for the next streamed delta
              wake = undefined;
              continue;
            }
            streamed = updates.splice(0).at(-1)!;
            yield { content: [...done, ...streamed], metadata: metadata() };
          }
          const result = await completion;
          addModel(result.model);
          const calls = result.toolCalls.filter((call) => call.function.name);
          if (!calls.length) {
            done.push(...parts(result.text, []));
            noAnswerNotice(done);
            yield { content: done, status: { type: "complete", reason: "stop" }, metadata: metadata() };
            return;
          }
          if (last) {
            // tool calls asked for anyway (in a provider specific format…)
            done.push(...parts(result.text, []), { type: "text", text: `\n\n_${t("agent.tooManySteps")}_` });
            yield { content: done, status: { type: "incomplete", reason: "other" }, metadata: metadata() };
            return;
          }
          // Executes the tool calls, then gives their results back to the model
          const toolCalls = calls.map((call, i) => ({ ...call, id: call.id || `call-${step}-${i}` }));
          chat.push({ role: "assistant", content: result.text || null, tool_calls: toolCalls });
          const running = parts(result.text, toolCalls);
          yield { content: [...done, ...running], metadata: metadata() };
          const results = await Promise.all( // NOSONAR each step needs the tool results of the previous one
            toolCalls.map((call) => callTool(mcp, call.function.name, { ...parseArguments(call.function.arguments) }, abortSignal)),
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
          yield { content: done, metadata: metadata() };
          // stopped by the user during the tool calls: no model call with their (cancelled) results
          abortSignal.throwIfAborted();
        }
      } finally {
        settings.onRunEnd?.();
      }
    },
  };
}
