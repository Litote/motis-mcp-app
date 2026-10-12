/**
 * OpenRouter, called from the browser (CORS allowed): the user brings their own key, through the OAuth PKCE flow or
 * pasted. The key is kept in sessionStorage (cleared with the tab), never sent elsewhere than openrouter.ai.
 */
const API = "https://openrouter.ai/api/v1";
const KEY_STORAGE = "openrouter-key";
const VERIFIER_STORAGE = "openrouter-pkce-verifier";
const MODEL_STORAGE = "openrouter-model";

/** Free model selected by default: reliable tool calling in our tests (5/5 tools and arguments right). */
export const DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";

// ─── Key ──────────────────────────────────────────────────────────────────────

export function getKey(): string | null {
  return sessionStorage.getItem(KEY_STORAGE);
}

/** Format of the OpenRouter API keys. */
const KEY_FORMAT = /^sk-or-[\w-]+$/;

/** Stores [key], after checking it is an OpenRouter key. */
export function setKey(key: string): void {
  const trimmed = key.trim();
  if (!KEY_FORMAT.test(trimmed)) throw new Error("Not an OpenRouter key (sk-or-…).");
  sessionStorage.setItem(KEY_STORAGE, trimmed);
}

export function forgetKey(): void {
  sessionStorage.removeItem(KEY_STORAGE);
}

// ─── OAuth PKCE ───────────────────────────────────────────────────────────────

function base64Url(bytes: Uint8Array): string {
  // "=" is only the padding of base64
  return btoa(String.fromCodePoint(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

/** Redirects to OpenRouter, which comes back to this page with `?code=`. */
export async function startLogin(): Promise<void> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  sessionStorage.setItem(VERIFIER_STORAGE, verifier);
  const callback = window.location.origin + window.location.pathname;
  const url = new URL("https://openrouter.ai/auth");
  url.searchParams.set("callback_url", callback);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("key_label", "MOTIS explorer");
  window.location.assign(url.href);
}

/** Back from OpenRouter: exchanges the `code` of the URL for a key. Returns false when the URL has no code. */
export async function completeLogin(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) return false;
  const verifier = sessionStorage.getItem(VERIFIER_STORAGE);
  sessionStorage.removeItem(VERIFIER_STORAGE);
  window.history.replaceState(null, "", window.location.pathname);
  if (!verifier) throw new Error("Login expired: please try again.");
  const response = await fetch(`${API}/auth/keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
  });
  if (!response.ok) throw new Error(`OpenRouter login failed (HTTP ${response.status})`);
  const { key } = (await response.json()) as { key: string };
  setKey(key);
  return true;
}

// ─── Models and quota ─────────────────────────────────────────────────────────

export interface Model {
  id: string;
  name: string;
  free: boolean;
  /** Release date, seconds since the epoch. */
  created: number;
}

interface ApiModel {
  id: string;
  name: string;
  created?: number;
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
}

/** Models able to call tools, free ones first. */
export async function listModels(): Promise<Model[]> {
  const response = await fetch(`${API}/models`);
  if (!response.ok) throw new Error(`OpenRouter models: HTTP ${response.status}`);
  const { data } = (await response.json()) as { data: ApiModel[] };
  return data
    .filter((m) => m.supported_parameters?.includes("tools"))
    .map((m) => ({
      id: m.id,
      name: m.name,
      free: m.id.endsWith(":free") || (Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0),
      created: m.created ?? 0,
    }))
    .sort((a, b) => Number(b.free) - Number(a.free) || a.name.localeCompare(b.name));
}

/** Providers whose paid models are proposed by default (the full list has hundreds of models). */
const MAJOR_PROVIDERS = new Set([
  "anthropic",
  "openai",
  "google",
  "mistralai",
  "deepseek",
  "qwen",
  "x-ai",
  "moonshotai",
  "z-ai",
  "meta-llama",
]);
/** Variants and specialized models, not for a chat with tools. */
const SPECIALIZED = /preview|audio|image|banana|codex|customtools|safeguard|vision|omni|devstral|\b(exp|code|build)\b|\(batch\)/i;
/** Models older than this, relative to the newest one, are left out (aliases excepted). */
const MAX_AGE_SECONDS = 548 * 24 * 3600;
/** Most recent models proposed per provider, besides its "latest" aliases. */
const MODELS_PER_PROVIDER = 5;

/**
 * Paid models proposed by default: the "latest" aliases (`~`) and the most recent general models of the major
 * providers. Variants (`:batch`, `:online`…), previews and specialized models are left out.
 */
export function recommendedPaidModels(models: Model[]): Model[] {
  const candidates = models.filter((m) => {
    const provider = m.id.split("/")[0].replace(/^~/, "");
    return !m.free && MAJOR_PROVIDERS.has(provider) && !m.id.includes(":") && !SPECIALIZED.test(`${m.id} ${m.name}`);
  });
  const aliases = candidates.filter((m) => m.id.startsWith("~"));
  const newest = Math.max(0, ...candidates.map((m) => m.created));
  const byProvider = new Map<string, Model[]>();
  for (const m of candidates.filter((m) => !m.id.startsWith("~") && m.created >= newest - MAX_AGE_SECONDS)) {
    const provider = m.id.split("/")[0];
    byProvider.set(provider, [...(byProvider.get(provider) ?? []), m]);
  }
  const recent = [...byProvider.values()].flatMap((list) => list.toSorted((a, b) => b.created - a.created).slice(0, MODELS_PER_PROVIDER));
  const byName = (a: Model, b: Model) => a.name.localeCompare(b.name);
  return [...aliases.sort(byName), ...recent.sort(byName)];
}

export function getSelectedModel(): string {
  return localStorage.getItem(MODEL_STORAGE) ?? DEFAULT_MODEL;
}

export function setSelectedModel(model: string): void {
  localStorage.setItem(MODEL_STORAGE, model);
}

export interface FreeQuota {
  used: number;
  limit: number;
  remaining: number;
}

/** Daily requests to free models, or null when unknown. */
export async function getFreeQuota(key: string): Promise<FreeQuota | null> {
  const response = await fetch(`${API}/key`, { headers: { Authorization: `Bearer ${key}` } });
  if (!response.ok) return null;
  const { data } = (await response.json()) as { data?: { free_model_daily_requests?: FreeQuota } };
  return data?.free_model_daily_requests ?? null;
}

// ─── Chat completions (streaming) ─────────────────────────────────────────────

export interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ChatTool {
  type: "function";
  function: { name: string; description?: string; parameters: unknown };
}

/** Error of OpenRouter, with a message for the user. */
export class OpenRouterError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function errorMessage(status: number, detail: string): string {
  if (status === 401) return "OpenRouter key invalid or revoked: log in again.";
  if (status === 402) return "No OpenRouter credits left for this model: choose a free model.";
  if (status === 429)
    return `Rate limited by OpenRouter (free quota reached, or provider busy): retry later or choose another model. ${detail}`;
  return `OpenRouter error (HTTP ${status}): ${detail}`;
}

export interface ChatDelta {
  /** Text received so far. */
  text: string;
  /** Tool calls received so far (arguments possibly incomplete while streaming). */
  toolCalls: ChatToolCall[];
}

/**
 * Streams a chat completion; [onDelta] receives the cumulative text and tool calls. [fallbackModels] are tried by
 * OpenRouter when [model] fails (rate limited provider…).
 */
export async function streamChat(
  key: string,
  model: string,
  fallbackModels: string[],
  messages: ChatMessage[],
  tools: ChatTool[],
  signal: AbortSignal,
  onDelta: (delta: ChatDelta) => void,
): Promise<ChatDelta> {
  const response = await fetch(`${API}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": window.location.origin,
      "X-Title": "MOTIS explorer",
    },
    body: JSON.stringify({
      model,
      ...(fallbackModels.length ? { models: [model, ...fallbackModels] } : {}),
      messages,
      tools,
      stream: true,
    }),
  });
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new OpenRouterError(response.status, errorMessage(response.status, extractError(detail)));
  }
  const state: ChatDelta = { text: "", toolCalls: [] };
  for await (const data of sseData(response.body)) {
    if (data === "[DONE]") break;
    const chunk = JSON.parse(data);
    if (chunk.error) {
      throw new OpenRouterError(chunk.error.code ?? 500, errorMessage(chunk.error.code ?? 500, chunk.error.message ?? ""));
    }
    applyDelta(state, chunk.choices?.[0]?.delta);
    onDelta(state);
  }
  return state;
}

function extractError(body: string): string {
  try {
    const json = JSON.parse(body);
    return json.error?.metadata?.raw ?? json.error?.message ?? body;
  } catch {
    return body.slice(0, 200);
  }
}

interface StreamDelta {
  content?: string | null;
  tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
}

/** Merges a streamed delta: text is appended, tool call fragments are merged by index. */
export function applyDelta(state: ChatDelta, delta: StreamDelta | undefined): void {
  if (!delta) return;
  if (delta.content) state.text += delta.content;
  for (const fragment of delta.tool_calls ?? []) {
    const call = (state.toolCalls[fragment.index] ??= {
      id: "",
      type: "function",
      function: { name: "", arguments: "" },
    });
    if (fragment.id) call.id = fragment.id;
    if (fragment.function?.name) call.function.name += fragment.function.name;
    if (fragment.function?.arguments) call.function.arguments += fragment.function.arguments;
  }
}

/** `data:` payloads of a server-sent events stream (comments such as `: OPENROUTER PROCESSING` are skipped). */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trimEnd();
      buffer = buffer.slice(newline + 1);
      if (line.startsWith("data:")) yield line.slice(5).trim();
    }
  }
}
