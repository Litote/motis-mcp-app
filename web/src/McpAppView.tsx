/**
 * View of a tool call (MCP App): the `ui://` resource of the tool, rendered in the sandbox (sandbox.ts) and connected to
 * the MCP server through an AppBridge, as in the ext-apps reference host. The view receives the tool arguments and
 * result, and can call the server tools itself (navigation: departures of a clicked stop, next page…).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppBridge,
  PostMessageTransport,
  buildAllowAttribute,
  type McpUiSandboxProxyReadyNotification,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { loadConfig } from "./config";
import { IMPLEMENTATION, connectMcp, toolView, type McpServer, type ViewResource } from "./mcp";
import { setViewContext } from "./agent";

const PROXY_READY: McpUiSandboxProxyReadyNotification["method"] = "ui/notifications/sandbox-proxy-ready";

export interface McpAppViewProps {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result: CallToolResult;
  /** A message sent by the view on behalf of the user (ui/message). */
  onMessage(text: string): void;
}

function theme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Loads sandbox.html (CSP of the view as query parameter) and resolves when the sandbox is ready. */
async function loadSandbox(iframe: HTMLIFrameElement, view: ViewResource): Promise<void> {
  const { sandboxUrl } = await loadConfig();
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
  const allow = buildAllowAttribute(view.permissions);
  if (allow) iframe.setAttribute("allow", allow);
  const ready = new Promise<void>((resolve) => {
    const listener = ({ source, data }: MessageEvent) => {
      if (source === iframe.contentWindow && data?.method === PROXY_READY) {
        window.removeEventListener("message", listener);
        resolve();
      }
    };
    window.addEventListener("message", listener);
  });
  const url = new URL(sandboxUrl);
  if (view.csp) url.searchParams.set("csp", JSON.stringify(view.csp));
  iframe.src = url.href;
  await ready;
}

/** Display mode of a view, driven by the host (Close, Escape) or requested by the view (ui/request-display-mode). */
interface DisplayMode {
  isFullscreen(): boolean;
  set(fullscreen: boolean): void;
}

/** Inline, the view sets its height (onsizechange); fullscreen, it fills the window. */
function containerDimensions(iframe: HTMLIFrameElement, fullscreen: boolean) {
  const width = Math.round(iframe.getBoundingClientRect().width);
  return fullscreen ? { width, height: Math.round(iframe.getBoundingClientRect().height) } : { width, maxHeight: 6000 };
}

function createBridge(
  mcp: McpServer,
  iframe: HTMLIFrameElement,
  props: McpAppViewProps,
  display: DisplayMode,
): AppBridge {
  const capabilities = mcp.client.getServerCapabilities();
  const bridge = new AppBridge(
    mcp.client,
    IMPLEMENTATION,
    {
      openLinks: {},
      serverTools: capabilities?.tools,
      serverResources: capabilities?.resources,
      updateModelContext: { text: {} },
    },
    {
      hostContext: {
        theme: theme(),
        platform: "web",
        containerDimensions: { maxHeight: 6000 },
        displayMode: "inline",
        availableDisplayModes: ["inline", "fullscreen"],
      },
    },
  );
  bridge.onmessage = ({ content }) => {
    const text = content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n")
      .trim();
    if (text) props.onMessage(text);
    return Promise.resolve({});
  };
  bridge.onopenlink = ({ url }) => {
    window.open(url, "_blank", "noopener,noreferrer");
    return Promise.resolve({});
  };
  bridge.onupdatemodelcontext = ({ content }) => {
    const text = (content ?? [])
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n")
      .trim();
    setViewContext(props.toolCallId, text || null);
    return Promise.resolve({});
  };
  bridge.onsizechange = ({ height }) => {
    // fullscreen, the frame fills the window: the height of the content applies once back inline
    if (height !== undefined) iframe.dataset.inlineHeight = `${height}px`;
    if (height !== undefined && !display.isFullscreen()) iframe.style.height = `${height}px`;
  };
  bridge.onrequestdisplaymode = ({ mode }) => {
    display.set(mode === "fullscreen");
    return Promise.resolve({ mode: display.isFullscreen() ? "fullscreen" : "inline" });
  };
  const resize = new ResizeObserver(() => {
    const dimensions = containerDimensions(iframe, display.isFullscreen());
    if (dimensions.width > 0) void bridge.sendHostContextChange({ containerDimensions: dimensions });
  });
  resize.observe(iframe);
  const onclose = bridge.onclose;
  bridge.onclose = () => {
    resize.disconnect();
    onclose?.();
  };
  return bridge;
}

export function McpAppView(props: Readonly<McpAppViewProps>) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const fullscreenRef = useRef(false);
  const bridgeRef = useRef<AppBridge | undefined>(undefined);
  const closeRef = useRef<HTMLButtonElement>(null);
  // The view is set up once per tool call: the props of a completed call do not change
  const propsRef = useRef(props);
  propsRef.current = props;

  /** Single path for every display mode change: the view is told the mode, then its new dimensions. */
  const setDisplayMode = useCallback((value: boolean) => {
    if (fullscreenRef.current === value) return;
    fullscreenRef.current = value;
    setFullscreen(value);
    const iframe = iframeRef.current;
    if (!value && iframe?.dataset.inlineHeight) iframe.style.height = iframe.dataset.inlineHeight;
    void bridgeRef.current?.sendHostContextChange({ displayMode: value ? "fullscreen" : "inline" });
  }, []);

  // Fullscreen: Escape closes (when the focus is in the app; in the view, the view asks for inline mode itself), the
  // page behind does not scroll
  useEffect(() => {
    if (!fullscreen) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setDisplayMode(false);
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [fullscreen, setDisplayMode]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    let bridge: AppBridge | undefined;
    let cancelled = false;
    (async () => {
      const mcp = await connectMcp();
      const view = await toolView(mcp, props.toolName);
      if (!view || cancelled) return;
      await loadSandbox(iframe, view);
      if (cancelled) return;
      bridge = createBridge(mcp, iframe, propsRef.current, {
        isFullscreen: () => fullscreenRef.current,
        set: setDisplayMode,
      });
      bridgeRef.current = bridge;
      const initialized = new Promise<void>((resolve) => (bridge!.oninitialized = () => resolve()));
      await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
      await bridge.sendSandboxResourceReady({ html: view.html, csp: view.csp, permissions: view.permissions });
      await initialized;
      if (cancelled) return;
      await bridge.sendToolInput({ arguments: propsRef.current.args });
      await bridge.sendToolResult(propsRef.current.result);
    })().catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      setViewContext(props.toolCallId, null);
      bridgeRef.current = undefined;
      void bridge?.close();
    };
  }, [props.toolCallId, props.toolName, setDisplayMode]);

  if (error) return <div className="view-error">View unavailable: {error}</div>;
  return (
    <div className={fullscreen ? "view view-fullscreen" : "view"}>
      {fullscreen && (
        <button
          ref={closeRef}
          type="button"
          className="view-close"
          onClick={() => setDisplayMode(false)}
          title="Close (Escape)"
        >
          Close
        </button>
      )}
      <iframe ref={iframeRef} title={props.toolName} className="view-frame" />
    </div>
  );
}
