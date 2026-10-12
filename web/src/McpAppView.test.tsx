// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** AppBridge of the last view: its handlers are the ones set by McpAppView. */
type Handler = (params: Record<string, unknown>) => unknown;
interface FakeBridge {
  onmessage?: Handler;
  onopenlink?: Handler;
  onupdatemodelcontext?: Handler;
  onsizechange?: Handler;
  onrequestdisplaymode?: Handler;
  oninitialized?: () => void;
  onclose?: () => void;
  connect: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  sendSandboxResourceReady: ReturnType<typeof vi.fn>;
  sendToolInput: ReturnType<typeof vi.fn>;
  sendToolResult: ReturnType<typeof vi.fn>;
  sendHostContextChange: ReturnType<typeof vi.fn>;
}

const mocks = vi.hoisted(() => ({
  bridges: [] as FakeBridge[],
  connectMcp: vi.fn(),
  toolView: vi.fn(),
  setViewContext: vi.fn(),
  resizeCallbacks: [] as (() => void)[],
}));

vi.mock("@modelcontextprotocol/ext-apps/app-bridge", () => ({
  AppBridge: vi.fn(function (this: FakeBridge) {
    this.connect = vi.fn(async () => undefined);
    this.close = vi.fn(async () => this.onclose?.());
    // the view initializes once it has its HTML
    this.sendSandboxResourceReady = vi.fn(async () => setTimeout(() => this.oninitialized?.()));
    this.sendToolInput = vi.fn(async () => undefined);
    this.sendToolResult = vi.fn(async () => undefined);
    this.sendHostContextChange = vi.fn(async () => undefined);
    mocks.bridges.push(this);
  }),
  PostMessageTransport: vi.fn(function () {}),
  buildAllowAttribute: (permissions?: { geolocation?: object }) => (permissions?.geolocation ? "geolocation" : ""),
}));
vi.mock("./mcp", () => ({ IMPLEMENTATION: { name: "test", version: "1" }, connectMcp: mocks.connectMcp, toolView: mocks.toolView }));
vi.mock("./agent", () => ({ setViewContext: mocks.setViewContext }));
vi.mock("./config", () => ({ loadConfig: async () => ({ sandboxUrl: "https://sandbox.example/sandbox.html" }) }));

const { McpAppView } = await import("./McpAppView");

const RESULT = { content: [{ type: "text" as const, text: "12:04" }] };
const server = { client: { getServerCapabilities: () => ({ tools: {}, resources: {} }) } };

function frame(): HTMLIFrameElement {
  return screen.getByTitle("departures") as HTMLIFrameElement;
}

/** Renders the view and plays the sandbox handshake. */
async function renderView(onMessage = vi.fn()): Promise<FakeBridge> {
  render(<McpAppView toolCallId="call-1" toolName="departures" args={{ stop: "Lyon" }} result={RESULT} onMessage={onMessage} />);
  await waitFor(() => expect(frame().src).not.toBe(""));
  window.dispatchEvent(new MessageEvent("message", { source: frame().contentWindow, data: { method: "ui/notifications/sandbox-proxy-ready" } }));
  await waitFor(() => expect(mocks.bridges.at(-1)?.sendToolResult).toHaveBeenCalled());
  return mocks.bridges.at(-1)!;
}

beforeEach(() => {
  mocks.connectMcp.mockResolvedValue(server);
  mocks.toolView.mockResolvedValue({ html: "<html></html>", csp: { resourceDomains: ["https://tiles"] }, permissions: { geolocation: {} } });
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal(
    "ResizeObserver",
    vi.fn(function (callback: () => void) {
      mocks.resizeCallbacks.push(callback);
      return { observe: vi.fn(), disconnect: vi.fn() };
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mocks.bridges.length = 0;
  mocks.resizeCallbacks.length = 0;
});

describe("McpAppView", () => {
  it("loads the view in the sandbox and sends it the tool input and result", async () => {
    const bridge = await renderView();

    const url = new URL(frame().src);
    expect(url.origin + url.pathname).toBe("https://sandbox.example/sandbox.html");
    expect(JSON.parse(url.searchParams.get("csp")!)).toEqual({ resourceDomains: ["https://tiles"] });
    expect(frame().getAttribute("allow")).toBe("geolocation");
    expect(bridge.sendSandboxResourceReady).toHaveBeenCalledWith({
      html: "<html></html>",
      csp: { resourceDomains: ["https://tiles"] },
      permissions: { geolocation: {} },
    });
    expect(bridge.sendToolInput).toHaveBeenCalledWith({ arguments: { stop: "Lyon" } });
    expect(bridge.sendToolResult).toHaveBeenCalledWith(RESULT);
  });

  it("handles the requests of the view", async () => {
    const onMessage = vi.fn();
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const bridge = await renderView(onMessage);

    await bridge.onmessage!({ content: [{ type: "text", text: " Departures of Perrache " }, { type: "image" }] });
    expect(onMessage).toHaveBeenCalledWith("Departures of Perrache");

    await bridge.onopenlink!({ url: "https://tcl.fr" });
    expect(open).toHaveBeenCalledWith("https://tcl.fr", "_blank", "noopener,noreferrer");

    await bridge.onupdatemodelcontext!({ content: [{ type: "text", text: "Selected: T1" }] });
    expect(mocks.setViewContext).toHaveBeenCalledWith("call-1", "Selected: T1");
    await bridge.onupdatemodelcontext!({});
    expect(mocks.setViewContext).toHaveBeenLastCalledWith("call-1", null);

    act(() => void bridge.onsizechange!({ height: 420 }));
    expect(frame().style.height).toBe("420px");

    mocks.resizeCallbacks.forEach((callback) => callback());
    // jsdom has no layout: width 0, nothing sent
    expect(bridge.sendHostContextChange).not.toHaveBeenCalled();
  });

  it("switches to fullscreen on request of the view, and back with Close or Escape", async () => {
    const bridge = await renderView();
    act(() => void bridge.onsizechange!({ height: 300 }));

    let mode: unknown;
    await act(async () => {
      mode = await bridge.onrequestdisplaymode!({ mode: "fullscreen" });
    });
    expect(mode).toEqual({ mode: "fullscreen" });
    expect(document.body.style.overflow).toBe("hidden");
    expect(bridge.sendHostContextChange).toHaveBeenCalledWith({ displayMode: "fullscreen" });
    // fullscreen: the size of the content applies once back inline
    act(() => void bridge.onsizechange!({ height: 900 }));
    expect(frame().style.height).toBe("300px");

    fireEvent.click(screen.getByText("Close"));
    expect(screen.queryByText("Close")).toBeNull();
    expect(frame().style.height).toBe("900px");
    expect(bridge.sendHostContextChange).toHaveBeenLastCalledWith({ displayMode: "inline" });

    await act(async () => void (await bridge.onrequestdisplaymode!({ mode: "fullscreen" })));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("Close")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });

  it("closes the bridge when removed", async () => {
    const bridge = await renderView();
    cleanup();
    expect(bridge.close).toHaveBeenCalled();
    expect(mocks.setViewContext).toHaveBeenCalledWith("call-1", null);
  });

  it("shows the errors", async () => {
    mocks.toolView.mockRejectedValue(new Error("server down"));
    render(<McpAppView toolCallId="call-1" toolName="departures" args={{}} result={RESULT} onMessage={vi.fn()} />);

    expect(await screen.findByText("View unavailable: server down")).toBeDefined();
  });
});
