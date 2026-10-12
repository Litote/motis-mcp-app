/** Chat screen (loaded once logged in): assistant-ui thread, agent, model picker and quota. */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useLocalRuntime,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import { createAgent } from "./agent";
import {
  DEFAULT_MODEL,
  forgetKey,
  getFreeQuota,
  getKey,
  getSelectedModel,
  listModels,
  recommendedPaidModels,
  setSelectedModel,
  type FreeQuota,
  type Model,
} from "./openrouter";
import { AppendMessageContext, ToolCall } from "./ToolCall";

const SUGGESTIONS = [
  "Next departures at Lyon Part-Dieu",
  "How to go from Paris Gare de Lyon to Versailles?",
  "Which lines run around Place Bellecour in Lyon?",
  "Shared bikes near Châtelet, Paris",
];

function MarkdownText() {
  return <MarkdownTextPrimitive remarkPlugins={[remarkGfm]} className="markdown" />;
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="message user">
      <MessagePrimitive.Parts />
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="message assistant">
      <MessagePrimitive.Parts components={{ Text: MarkdownText, tools: { Fallback: ToolCall } }} />
      <MessagePrimitive.Error>
        <ErrorPrimitive.Root className="message-error">
          <ErrorPrimitive.Message />
        </ErrorPrimitive.Root>
      </MessagePrimitive.Error>
    </MessagePrimitive.Root>
  );
}

function Thread() {
  return (
    <ThreadPrimitive.Root className="thread">
      <ThreadPrimitive.Viewport className="thread-viewport">
        <ThreadPrimitive.Empty>
          <div className="welcome">
            <h2>Explore public transport</h2>
            <p>Timetables, journeys, maps and shared mobility from Transitous (MOTIS).</p>
            <div className="suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <ThreadPrimitive.Suggestion key={suggestion} prompt={suggestion} send className="suggestion">
                  {suggestion}
                </ThreadPrimitive.Suggestion>
              ))}
            </div>
          </div>
        </ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages>
          {({ message }) => (message.role === "user" ? <UserMessage /> : <AssistantMessage />)}
        </ThreadPrimitive.Messages>
      </ThreadPrimitive.Viewport>
      <ComposerPrimitive.Root className="composer">
        <ComposerPrimitive.Input className="composer-input" placeholder="Ask about stops, journeys, lines…" autoFocus />
        <ThreadPrimitive.If running={false}>
          <ComposerPrimitive.Send className="composer-button">Send</ComposerPrimitive.Send>
        </ThreadPrimitive.If>
        <ThreadPrimitive.If running>
          <ComposerPrimitive.Cancel className="composer-button">Stop</ComposerPrimitive.Cancel>
        </ThreadPrimitive.If>
      </ComposerPrimitive.Root>
    </ThreadPrimitive.Root>
  );
}

/** Free models, recommended paid models, or every model able to call tools. */
function ModelPicker({ models, model, onSelect }: Readonly<{ models: Model[]; model: string; onSelect(id: string): void }>) {
  const [all, setAll] = useState(false);
  const free = models.filter((m) => m.free);
  const paid = all ? models.filter((m) => !m.free) : recommendedPaidModels(models);
  const listed = [...free, ...paid].some((m) => m.id === model);
  return (
    <span className="model-picker">
      <select value={model} onChange={(e) => onSelect(e.target.value)} aria-label="Model">
        {!listed && <option value={model}>{models.find((m) => m.id === model)?.name ?? model}</option>}
        <optgroup label="Free">
          {free.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.id === DEFAULT_MODEL ? " (recommended)" : ""}
            </option>
          ))}
        </optgroup>
        <optgroup label={all ? "Paid (OpenRouter credits)" : "Paid, main models (OpenRouter credits)"}>
          {paid.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </optgroup>
      </select>
      <label className="model-all" title="Every model of OpenRouter able to call tools">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> All models
      </label>
    </span>
  );
}

/** Current model settings, read by the agent at each run. */
const settingsRef: { model: string; models: Model[] } = { model: DEFAULT_MODEL, models: [] };

export default function Chat({ apiKey }: Readonly<{ apiKey: string }>) {
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState(getSelectedModel);
  const [quota, setQuota] = useState<FreeQuota | null>(null);

  const refreshQuota = useCallback(() => {
    getFreeQuota(apiKey).then(setQuota, () => setQuota(null));
  }, [apiKey]);

  useEffect(() => {
    listModels().then(setModels, () => setModels([]));
    refreshQuota();
  }, [refreshQuota]);

  // The adapter reads the current model through refs to the state, so it is created once
  const settings = useMemo(() => ({ model, models }), [model, models]);
  const agent = useMemo(
    () =>
      createAgent({
        key: getKey,
        model: () => settingsRef.model,
        // free models fall back on other free models when their provider is rate limited
        fallbackModels: () =>
          settingsRef.model.endsWith(":free")
            ? settingsRef.models
                .filter((m) => m.free && m.id !== settingsRef.model && m.id !== "openrouter/free")
                .slice(0, 2)
                .map((m) => m.id)
            : [],
        onRunEnd: refreshQuota,
      }),
    [refreshQuota],
  );
  settingsRef.model = settings.model;
  settingsRef.models = settings.models;

  const runtime = useLocalRuntime(agent);
  const append = useCallback((text: string) => runtime.thread.append(text), [runtime]);

  const selectModel = (id: string) => {
    setSelectedModel(id);
    setModel(id);
  };

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AppendMessageContext.Provider value={append}>
        <header className="header">
          <h1>MOTIS explorer</h1>
<ModelPicker models={models} model={model} onSelect={selectModel} />
          {quota && (
            <span className="quota" title="Requests to free models today">
              {quota.remaining}/{quota.limit} free requests left
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              forgetKey();
              window.location.reload();
            }}
          >
            Log out
          </button>
        </header>
        <Thread />
      </AppendMessageContext.Provider>
    </AssistantRuntimeProvider>
  );
}

