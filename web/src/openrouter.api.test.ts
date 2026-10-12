// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  completeLogin,
  DEFAULT_MODEL,
  forgetKey,
  getFreeQuota,
  getKey,
  getSelectedModel,
  listModels,
  OpenRouterError,
  setKey,
  setSelectedModel,
  startLogin,
  streamChat,
  type ChatDelta,
} from "./openrouter";

const KEY = "sk-or-v1-0123abcd";

function sse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      lines.forEach((line) => controller.enqueue(encoder.encode(`${line}\n\n`)));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("key", () => {
  it("stores a trimmed OpenRouter key", () => {
    setKey(`  ${KEY} `);
    expect(getKey()).toBe(KEY);
    forgetKey();
    expect(getKey()).toBeNull();
  });

  it("rejects what is not an OpenRouter key", () => {
    expect(() => setKey("<img src=x>")).toThrow("Not an OpenRouter key");
    expect(getKey()).toBeNull();
  });
});

describe("login", () => {
  it("keeps a PKCE verifier before leaving for OpenRouter", async () => {
    await startLogin();
    expect(sessionStorage.getItem("openrouter-pkce-verifier")).toMatch(/^[\w-]{43}$/);
  });

  it("is not completed without a code in the URL", async () => {
    expect(await completeLogin()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exchanges the code for a key", async () => {
    window.history.replaceState(null, "", "/?code=CODE");
    sessionStorage.setItem("openrouter-pkce-verifier", "VERIFIER");
    fetchMock.mockResolvedValue(Response.json({ key: KEY }));

    expect(await completeLogin()).toBe(true);

    expect(getKey()).toBe(KEY);
    expect(window.location.search).toBe("");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/auth/keys");
    expect(JSON.parse(init?.body as string)).toEqual({ code: "CODE", code_verifier: "VERIFIER", code_challenge_method: "S256" });
  });

  it("fails when the verifier is gone", async () => {
    window.history.replaceState(null, "", "/?code=CODE");
    await expect(completeLogin()).rejects.toThrow("Login expired");
  });

  it("fails when OpenRouter refuses the code", async () => {
    window.history.replaceState(null, "", "/?code=CODE");
    sessionStorage.setItem("openrouter-pkce-verifier", "VERIFIER");
    fetchMock.mockResolvedValue(new Response("", { status: 403 }));
    await expect(completeLogin()).rejects.toThrow("OpenRouter login failed (HTTP 403)");
  });
});

describe("models", () => {
  it("lists the models able to call tools, free ones first", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        data: [
          { id: "b/paid", name: "B paid", created: 10, pricing: { prompt: "0.1", completion: "0.2" }, supported_parameters: ["tools"] },
          { id: "a/free:free", name: "Z free", supported_parameters: ["tools"] },
          { id: "c/zero", name: "C zero", pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools", "stop"] },
          { id: "d/no-tools", name: "D", supported_parameters: ["stop"] },
        ],
      }),
    );

    expect(await listModels()).toEqual([
      { id: "c/zero", name: "C zero", free: true, created: 0 },
      { id: "a/free:free", name: "Z free", free: true, created: 0 },
      { id: "b/paid", name: "B paid", free: false, created: 10 },
    ]);
  });

  it("fails on an HTTP error", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    await expect(listModels()).rejects.toThrow("OpenRouter models: HTTP 500");
  });

  it("remembers the selected model", () => {
    expect(getSelectedModel()).toBe(DEFAULT_MODEL);
    setSelectedModel("openai/gpt");
    expect(getSelectedModel()).toBe("openai/gpt");
  });

  it("reads the free quota of the key", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ data: { free_model_daily_requests: { used: 3, limit: 50, remaining: 47 } } }));
    expect(await getFreeQuota(KEY)).toEqual({ used: 3, limit: 50, remaining: 47 });
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ Authorization: `Bearer ${KEY}` });

    fetchMock.mockResolvedValueOnce(Response.json({ data: {} }));
    expect(await getFreeQuota(KEY)).toBeNull();

    fetchMock.mockResolvedValueOnce(new Response("", { status: 401 }));
    expect(await getFreeQuota(KEY)).toBeNull();
  });
});

describe("streamChat", () => {
  const messages = [{ role: "user" as const, content: "Next train?" }];
  const signal = new AbortController().signal;

  it("streams the text and the tool calls, with the fallback models", async () => {
    fetchMock.mockResolvedValue(
      sse([
        ": OPENROUTER PROCESSING",
        `data: ${JSON.stringify({ choices: [{ delta: { content: "Let me check." } }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "departures", arguments: "{}" } }] } }] })}`,
        "data: [DONE]",
      ]),
    );
    const deltas: string[] = [];

    const result = await streamChat(KEY, "m1", ["m2"], messages, [], signal, (delta: ChatDelta) => deltas.push(delta.text));

    expect(result.text).toBe("Let me check.");
    expect(result.toolCalls).toEqual([{ id: "c1", type: "function", function: { name: "departures", arguments: "{}" } }]);
    expect(deltas).toEqual(["Let me check.", "Let me check."]);
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body).toMatchObject({ model: "m1", models: ["m1", "m2"], messages, stream: true });
  });

  it("sends no fallback list without fallback models", async () => {
    fetchMock.mockResolvedValue(sse(["data: [DONE]"]));
    await streamChat(KEY, "m1", [], messages, [], signal, () => undefined);
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).models).toBeUndefined();
  });

  it.each([
    [401, "{}", "OpenRouter key invalid or revoked: log in again."],
    [402, "{}", "No OpenRouter credits left for this model: choose a free model."],
    [429, JSON.stringify({ error: { metadata: { raw: "busy" } } }), "Rate limited by OpenRouter (free quota reached, or provider busy): retry later or choose another model. busy"],
    [500, JSON.stringify({ error: { message: "down" } }), "OpenRouter error (HTTP 500): down"],
    [502, "not json", "OpenRouter error (HTTP 502): not json"],
  ])("explains the HTTP error %i", async (status, body, message) => {
    fetchMock.mockResolvedValue(new Response(body, { status }));
    const error = await streamChat(KEY, "m1", [], messages, [], signal, () => undefined).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OpenRouterError);
    expect((error as OpenRouterError).status).toBe(status);
    expect((error as Error).message).toBe(message);
  });

  it("fails on an error in the stream", async () => {
    fetchMock.mockResolvedValue(sse([`data: ${JSON.stringify({ error: { code: 429, message: "quota" } })}`]));
    await expect(streamChat(KEY, "m1", [], messages, [], signal, () => undefined)).rejects.toThrow("Rate limited by OpenRouter");
  });
});
