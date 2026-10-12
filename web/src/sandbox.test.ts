// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HOST = "https://app.example";

/** Parent window of the sandbox, on another origin: its document is not readable. */
function crossOriginParent() {
  return {
    postMessage: vi.fn(),
    get document(): Document {
      throw new DOMException("Blocked a frame", "SecurityError");
    },
  };
}

let parent: ReturnType<typeof crossOriginParent>;
/** Message listeners of the sandbox: removed after each test (the window is shared). */
const listeners: EventListener[] = [];
const addEventListener = window.addEventListener.bind(window);
vi.spyOn(window, "addEventListener").mockImplementation(((type: string, listener: EventListener) => {
  if (type === "message") listeners.push(listener);
  addEventListener(type, listener);
}) as typeof window.addEventListener);
const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

function embed(top: unknown, referrer = `${HOST}/chat`) {
  Object.defineProperty(window, "top", { configurable: true, get: () => top });
  Object.defineProperty(window, "parent", { configurable: true, get: () => parent });
  Object.defineProperty(document, "referrer", { configurable: true, get: () => referrer });
}

async function start() {
  vi.resetModules();
  await import("./sandbox");
}

function send(data: unknown, source: unknown, origin: string) {
  window.dispatchEvent(new MessageEvent("message", { data, origin, source: source as MessageEventSource }));
}

beforeEach(() => {
  parent = crossOriginParent();
  document.body.innerHTML = "";
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ mcpUrl: "", sandboxUrl: "", hostOrigins: [HOST] })));
});

afterEach(() => {
  listeners.splice(0).forEach((listener) => window.removeEventListener("message", listener));
  vi.unstubAllGlobals();
  errors.mockClear();
});

describe("sandbox", () => {
  it("creates the view frame and tells the app it is ready", async () => {
    embed(parent);
    await start();

    expect(parent.postMessage).toHaveBeenCalledWith({ jsonrpc: "2.0", method: "ui/notifications/sandbox-proxy-ready", params: {} }, HOST);
    const inner = document.querySelector("iframe")!;
    expect(inner.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin allow-forms");
    expect(errors).not.toHaveBeenCalled();
  });

  it("writes the view with its sandbox and permissions, and relays the messages", async () => {
    embed(parent);
    await start();
    const inner = document.querySelector("iframe")!;

    send(
      {
        method: "ui/notifications/sandbox-resource-ready",
        params: { html: "<p>view</p>", sandbox: "allow-scripts", permissions: { geolocation: {}, clipboardWrite: {}, camera: {}, microphone: {} } },
      },
      parent,
      HOST,
    );
    expect(inner.getAttribute("sandbox")).toBe("allow-scripts");
    expect(inner.getAttribute("allow")).toBe("camera; microphone; geolocation; clipboard-write");
    expect(inner.contentDocument?.body.innerHTML).toBe("<p>view</p>");

    const toView = vi.spyOn(inner.contentWindow!, "postMessage").mockImplementation(() => undefined);
    send({ method: "ui/notifications/tool-result" }, parent, HOST);
    expect(toView).toHaveBeenCalledWith({ method: "ui/notifications/tool-result" }, window.location.origin);

    send({ method: "ui/initialize" }, inner.contentWindow, window.location.origin);
    expect(parent.postMessage).toHaveBeenLastCalledWith({ method: "ui/initialize" }, HOST);
  });

  it("ignores the messages of other origins", async () => {
    embed(parent);
    await start();
    const inner = document.querySelector("iframe")!;
    const toView = vi.spyOn(inner.contentWindow!, "postMessage").mockImplementation(() => undefined);
    parent.postMessage.mockClear();

    send({ method: "x" }, parent, "https://evil.example");
    send({ method: "y" }, inner.contentWindow, "https://evil.example");

    expect(toView).not.toHaveBeenCalled();
    expect(parent.postMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["is not embedded", () => embed(window), "The sandbox must be embedded in the app."],
    ["has no referrer", () => embed(parent, ""), "No referrer: cannot check the embedding app."],
    ["is embedded by another app", () => embed(parent, "https://evil.example/"), "Embedding origin not allowed: https://evil.example"],
    ["is on the origin of the app", () => embed({ document }), "The sandbox is on the origin of the app: it is not isolated."],
  ])("refuses to start when it %s", async (_, setup, message) => {
    setup();
    await start();

    expect(errors).toHaveBeenCalledWith("[sandbox]", new Error(message));
    expect(document.querySelector("iframe")).toBeNull();
  });
});
