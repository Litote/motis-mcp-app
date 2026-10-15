/** Chat screen (loaded once logged in): assistant-ui thread, agent, model picker and quota. */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  useLocalRuntime,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import { createAgent } from "./agent";
import { suggestions, t } from "./i18n";
import { useLocation } from "./location";
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

/**
 * Shown while the answer is running and nothing else moves: before the first streamed token, and while the model reads
 * the tool results (a running tool call has its own status, streamed text is visible).
 */
function Thinking() {
  const waiting = useAuiState((s) => {
    if (s.message.status?.type !== "running") return false;
    const last = s.message.content.at(-1);
    if (!last) return true;
    if (last.type === "tool-call") return last.result !== undefined;
    return last.type === "text" && !last.text;
  });
  if (!waiting) return null;
  return (
    <output className="thinking" aria-label={t("thinking")}>
      <span />
      <span />
      <span />
    </output>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="message assistant">
      <MessagePrimitive.Parts components={{ Text: MarkdownText, tools: { Fallback: ToolCall } }} />
      <Thinking />
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
            <h2>{t("welcome.title")}</h2>
            <p>{t("welcome.text")}</p>
            <div className="suggestions">
              {suggestions().map((suggestion) => (
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
        <ComposerPrimitive.Input className="composer-input" placeholder={t("composer.placeholder")} autoFocus />
        <ThreadPrimitive.If running={false}>
          <ComposerPrimitive.Send className="composer-button">{t("composer.send")}</ComposerPrimitive.Send>
        </ThreadPrimitive.If>
        <ThreadPrimitive.If running>
          <ComposerPrimitive.Cancel className="composer-button">{t("composer.stop")}</ComposerPrimitive.Cancel>
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
      <select value={model} onChange={(e) => onSelect(e.target.value)} aria-label={t("model.label")}>
        {!listed && <option value={model}>{models.find((m) => m.id === model)?.name ?? model}</option>}
        <optgroup label={t("model.free")}>
          {free.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.id === DEFAULT_MODEL ? t("model.recommended") : ""}
            </option>
          ))}
        </optgroup>
        <optgroup label={t(all ? "model.paidAll" : "model.paid")}>
          {paid.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </optgroup>
      </select>
      <label className="model-all" title={t("model.allTitle")}>
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> {t("model.all")}
      </label>
    </span>
  );
}

/** Opt-in sharing of the position of the user with the model. */
function LocationButton() {
  const { status, toggle } = useLocation();
  return (
    <button
      type="button"
      className={`location ${status}`}
      aria-pressed={status === "on" || status === "locating"}
      title={t(`location.${status}`)}
      onClick={toggle}
    >
      {t("location.button")}
    </button>
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
          <LocationButton />
          {quota && (
            <span className="quota" title={t("quota.title")}>
              {t("quota.left", { remaining: quota.remaining, limit: quota.limit })}
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              forgetKey();
              window.location.reload();
            }}
          >
            {t("logout")}
          </button>
        </header>
        <Thread />
      </AppendMessageContext.Provider>
    </AssistantRuntimeProvider>
  );
}

