// Connection of a view to its host (MCP Apps), theming, and server tool calls.
import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import "./style.css";

export type Args = Record<string, unknown>;

interface ToolResultLike {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface ViewHandlers {
  /** Data of a tool result (structuredContent), and the arguments of the call when known. */
  render(data: { kind: string } & Record<string, unknown>, args: Args): void;
  /** Called when the host changes the theme. */
  themeChanged?(theme: "light" | "dark"): void;
}

let locale: string | undefined;

/** Locale of the host, for date formatting. */
export const hostLocale = (): string | undefined => locale;

const statusEl = () => document.getElementById("status");

export function setStatus(text: string, kind: "info" | "error" | "loading" = "info"): void {
  const el = statusEl();
  if (!el) return;
  el.textContent = text;
  el.dataset.kind = kind;
  el.hidden = text === "";
}

function textOf(result: ToolResultLike): string {
  return (result.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
}

function applyContext(ctx: McpUiHostContext, handlers: ViewHandlers): void {
  if (ctx.theme) {
    applyDocumentTheme(ctx.theme);
    handlers.themeChanged?.(ctx.theme);
  }
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  if (ctx.locale) locale = ctx.locale;
  if (ctx.safeAreaInsets) {
    const { top, right, bottom, left } = ctx.safeAreaInsets;
    document.body.style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
  }
  const fullscreen = document.getElementById("fullscreen");
  if (fullscreen && ctx.availableDisplayModes) {
    fullscreen.hidden = !ctx.availableDisplayModes.includes("fullscreen");
  }
  if (ctx.displayMode) document.documentElement.dataset.displayMode = ctx.displayMode;
}

/** Current theme of the document (set by the host, or by the system preference). */
export function currentTheme(): "light" | "dark" {
  const theme = document.documentElement.dataset.theme;
  if (theme === "light" || theme === "dark") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Creates the view App, wires the host notifications, and connects to the host. */
export function startView(name: string, handlers: ViewHandlers): App {
  const app = new App({ name, version: "1.0.0" });
  let lastArgs: Args = {};

  // handlers are set before connect() so that the initial tool input/result are not missed
  app.ontoolinput = (params) => {
    lastArgs = (params.arguments ?? {}) as Args;
    setStatus("Loading…", "loading");
  };
  app.ontoolresult = (result) => {
    const r = result as ToolResultLike;
    if (r.isError) {
      setStatus(textOf(r) || "Error", "error");
    } else if (r.structuredContent && typeof r.structuredContent.kind === "string") {
      setStatus("");
      handlers.render(r.structuredContent as { kind: string }, lastArgs);
    } else {
      setStatus(textOf(r));
    }
  };
  app.ontoolcancelled = () => setStatus("Cancelled", "error");
  app.onhostcontextchanged = (ctx) => applyContext(ctx, handlers);

  const requestDisplayMode = async (mode: "inline" | "fullscreen") => {
    try {
      const result = await app.requestDisplayMode({ mode });
      document.documentElement.dataset.displayMode = result.mode;
    } catch {
      // display mode not supported: ignored
    }
  };
  document.getElementById("fullscreen")?.addEventListener("click", () =>
    requestDisplayMode(document.documentElement.dataset.displayMode === "fullscreen" ? "inline" : "fullscreen"),
  );
  // Escape leaves fullscreen: the keyboard focus is in the view, the host does not receive the key
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.documentElement.dataset.displayMode === "fullscreen") {
      void requestDisplayMode("inline");
    }
  });

  app
    .connect()
    .then(() => {
      const ctx = app.getHostContext();
      if (ctx) applyContext(ctx, handlers);
    })
    .catch((e: unknown) => setStatus(`Connection to the host failed: ${String(e)}`, "error"));
  return app;
}

/**
 * Calls a server tool from the view and returns its structured content.
 * A tool error is thrown as an Error with the message of the tool.
 */
export async function callTool<T>(app: App, name: string, args: Args): Promise<T> {
  setStatus("Loading…", "loading");
  try {
    const result = (await app.callServerTool({ name, arguments: args })) as ToolResultLike;
    if (result.isError) throw new Error(textOf(result) || `${name} failed`);
    if (!result.structuredContent) throw new Error(`${name}: no data`);
    setStatus("");
    return result.structuredContent as T;
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), "error");
    throw e;
  }
}
