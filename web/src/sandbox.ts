/**
 * Outer frame of the view sandbox (double-iframe pattern of the MCP Apps reference host, ext-apps basic-host).
 *
 *   app (parent window) ↔ this frame (sandbox origin) ↔ view (inner frame, HTML written by document.write)
 *
 * The app and the sandbox have different origins: a view cannot reach the app (DOM, storage, OpenRouter key). This
 * frame relays the messages in both directions, after checking their origin.
 */
import type {
  McpUiResourcePermissions,
  McpUiSandboxProxyReadyNotification,
  McpUiSandboxResourceReadyNotification,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import { loadConfig } from "./config";

const RESOURCE_READY: McpUiSandboxResourceReadyNotification["method"] = "ui/notifications/sandbox-resource-ready";
const PROXY_READY: McpUiSandboxProxyReadyNotification["method"] = "ui/notifications/sandbox-proxy-ready";

/**
 * Permission policy of the view (same as buildAllowAttribute of ext-apps, inlined: importing it would load the whole
 * AppBridge in the sandbox).
 */
function allowAttribute(permissions: McpUiResourcePermissions | undefined): string {
  if (!permissions) return "";
  const allow: string[] = [];
  if (permissions.camera) allow.push("camera");
  if (permissions.microphone) allow.push("microphone");
  if (permissions.geolocation) allow.push("geolocation");
  if (permissions.clipboardWrite) allow.push("clipboard-write");
  return allow.join("; ");
}

/** True when the document of the app is readable: the sandbox is then on the origin of the app. */
function appReachable(): boolean {
  try {
    return window.top?.document != null;
  } catch (e) {
    if (e instanceof DOMException) return false;
    throw e;
  }
}

/** Writes the HTML of the view in the inner frame. */
function writeView(inner: HTMLIFrameElement, params: McpUiSandboxResourceReadyNotification["params"]): void {
  const { html, sandbox, permissions } = params;
  if (typeof sandbox === "string") inner.setAttribute("sandbox", sandbox);
  const allow = allowAttribute(permissions);
  if (allow) inner.setAttribute("allow", allow);
  if (typeof html !== "string") return;
  const doc = inner.contentDocument;
  if (doc) {
    doc.open();
    // document.write keeps the view in the origin of the sandbox, like the reference host
    doc.write(html); // NOSONAR deprecated in the DOM typings, still the reference way to write a frame
    doc.close();
  } else {
    inner.srcdoc = html;
  }
}

async function start(): Promise<void> {
  if (window.self === window.top) throw new Error("The sandbox must be embedded in the app.");
  if (!document.referrer) throw new Error("No referrer: cannot check the embedding app.");

  const hostOrigin = new URL(document.referrer).origin;
  const { hostOrigins } = await loadConfig();
  if (!hostOrigins.includes(hostOrigin)) throw new Error(`Embedding origin not allowed: ${hostOrigin}`);

  // Self-test: the app must be on another origin, so that reaching window.top fails
  if (appReachable()) throw new Error("The sandbox is on the origin of the app: it is not isolated.");

  const ownOrigin = window.location.origin;
  const inner = document.createElement("iframe");
  inner.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
  document.body.appendChild(inner);

  window.addEventListener("message", (event) => {
    if (event.source === window.parent) {
      if (event.origin !== hostOrigin) return;
      // the view is on the origin of the sandbox (its messages are only accepted from it, below)
      if (event.data?.method === RESOURCE_READY) writeView(inner, event.data.params);
      else inner.contentWindow?.postMessage(event.data, ownOrigin);
    } else if (event.source === inner.contentWindow) {
      if (event.origin !== ownOrigin) return;
      window.parent.postMessage(event.data, hostOrigin);
    }
  });

  window.parent.postMessage({ jsonrpc: "2.0", method: PROXY_READY, params: {} }, hostOrigin);
}

try {
  await start();
} catch (e) {
  console.error("[sandbox]", e);
}
