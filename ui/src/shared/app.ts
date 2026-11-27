// Connection of a view to its host (MCP Apps), theming, and server tool calls.
import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiDisplayMode,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import { setLocale, t, translateDocument } from "./i18n";
import "./style.css";

export type Args = Record<string, unknown>;

interface ToolResultLike {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

type Legs = { legs?: Array<Record<string, unknown>> };

/**
 * Paths of the legs of a result, in its `_meta` (see server/.../dto/Dtos.kt LegPolylines): not in the structured
 * content, which some hosts give to the model. Same shape as the result: by itinerary then leg, or by leg for `itinerary`.
 */
interface LegPolylines {
  itineraries?: unknown[][];
  direct?: unknown[][];
  itinerary?: unknown[];
}

function putPolylines(itinerary: Legs | undefined, polylines: unknown[] | undefined): Legs | undefined {
  if (!itinerary?.legs || !polylines) return itinerary;
  return { ...itinerary, legs: itinerary.legs.map((leg, i) => (polylines[i] ? { ...leg, polyline: polylines[i] } : leg)) };
}

/**
 * Structured content of [result] with the data for the view only put back from its `_meta` (see server/.../ToolSupport.kt
 * ToolOutput): the top-level fields of `_meta.view` (e.g. the stops with their coordinates, in place of those without
 * given to the model), and the paths of the legs.
 */
export function structuredData(result: ToolResultLike): Record<string, unknown> | undefined {
  const content = result.structuredContent;
  const view = result._meta?.view as Record<string, unknown> | undefined;
  const data = content && view ? { ...content, ...view } : content;
  const polylines = result._meta?.legPolylines as LegPolylines | undefined;
  if (!data || !polylines) return data;
  const merged: Record<string, unknown> = { ...data };
  for (const key of ["itineraries", "direct"] as const) {
    const itineraries = data[key] as Legs[] | undefined;
    if (itineraries && polylines[key]) merged[key] = itineraries.map((it, i) => putPolylines(it, polylines[key]?.[i]));
  }
  if (polylines.itinerary) merged.itinerary = putPolylines(data.itinerary as Legs | undefined, polylines.itinerary);
  return merged;
}

export interface ViewHandlers {
  /** Data of a tool result (structuredContent), and the arguments of the call when known. */
  render(data: { kind: string } & Record<string, unknown>, args: Args): void;
  /** Called when the host changes the theme. */
  themeChanged?(theme: "light" | "dark"): void;
  /** Called when the view goes fullscreen or back inline (the document has `data-display-mode` set already). */
  displayModeChanged?(mode: McpUiDisplayMode): void;
  /**
   * Loads again what the view shows, for the current time (refresh button of the header, shown once a result is rendered
   * when given). The errors are reported in the status bar by the tool calls.
   */
  refresh?(): Promise<void>;
}

/** True when the view is fullscreen: the views lay their content out to fill the window (style.css). */
export const isFullscreen = (): boolean => document.documentElement.dataset.displayMode === "fullscreen";

/** Sets the display mode of the document, and tells the view when it changes. */
function setDisplayMode(mode: McpUiDisplayMode, handlers: ViewHandlers): void {
  if (document.documentElement.dataset.displayMode === mode) return;
  document.documentElement.dataset.displayMode = mode;
  handlers.displayModeChanged?.(mode);
}

export { hostLocale } from "./i18n";

const refreshButton = () => document.getElementById("refresh") as HTMLButtonElement | null;

/** Shows the refresh button of the header, or hides it (e.g. a view showing something that does not change with time). */
export function showRefresh(visible: boolean): void {
  const button = refreshButton();
  if (button) button.hidden = !visible;
}

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
  if (ctx.locale) {
    setLocale(ctx.locale);
    if (statusEl()?.dataset.kind === "loading") setStatus(t("loading"), "loading");
  }
  if (ctx.safeAreaInsets) {
    const { top, right, bottom, left } = ctx.safeAreaInsets;
    document.body.style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
  }
  const fullscreen = document.getElementById("fullscreen");
  if (fullscreen && ctx.availableDisplayModes) {
    fullscreen.hidden = !ctx.availableDisplayModes.includes("fullscreen");
  }
  if (ctx.displayMode) setDisplayMode(ctx.displayMode, handlers);
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
  // static texts in the language of the browser until the host gives its locale
  translateDocument();
  if (statusEl()?.dataset.kind === "loading") setStatus(t("loading"), "loading");

  // handlers are set before connect() so that the initial tool input/result are not missed
  app.ontoolinput = (params) => {
    lastArgs = (params.arguments ?? {}) as Args;
    setStatus(t("loading"), "loading");
  };
  app.ontoolresult = (result) => {
    const r = result as ToolResultLike;
    if (r.isError) {
      setStatus(textOf(r) || t("error"), "error");
    } else if (r.structuredContent && typeof r.structuredContent.kind === "string") {
      setStatus("");
      // before the rendering: a view may hide it for what it shows
      if (handlers.refresh) showRefresh(true);
      handlers.render(structuredData(r) as { kind: string }, lastArgs);
    } else {
      setStatus(textOf(r));
    }
  };
  app.ontoolcancelled = () => setStatus(t("cancelled"), "error");
  app.onhostcontextchanged = (ctx) => applyContext(ctx, handlers);

  const requestDisplayMode = async (mode: "inline" | "fullscreen") => {
    try {
      const result = await app.requestDisplayMode({ mode });
      setDisplayMode(result.mode, handlers);
    } catch {
      // display mode not supported: ignored
    }
  };
  // one refresh at a time: the icon turns until the view is loaded again
  refreshButton()?.addEventListener("click", async () => {
    const button = refreshButton()!;
    if (!handlers.refresh || button.getAttribute("aria-busy") === "true") return;
    button.setAttribute("aria-busy", "true");
    try {
      await handlers.refresh();
    } catch {
      // reported in the status bar
    } finally {
      button.removeAttribute("aria-busy");
    }
  });
  document.getElementById("fullscreen")?.addEventListener("click", () =>
    requestDisplayMode(isFullscreen() ? "inline" : "fullscreen"),
  );
  // the links (of the alerts) are opened by the host: the sandbox of the view may block them
  document.addEventListener("click", (event) => {
    const link = (event.target as Element | null)?.closest?.<HTMLAnchorElement>("a[data-link]");
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    app.openLink({ url: link.href }).catch(() => window.open(link.href, "_blank", "noopener"));
  });
  // Escape leaves fullscreen: the keyboard focus is in the view, the host does not receive the key
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isFullscreen()) {
      void requestDisplayMode("inline");
    }
  });

  app
    .connect()
    .then(() => {
      const ctx = app.getHostContext();
      if (ctx) applyContext(ctx, handlers);
    })
    .catch((e: unknown) => setStatus(t("connectionFailed", { error: String(e) }), "error"));
  return app;
}

/** Options of a server tool call: [quiet], no loading status (the view shows the loading where the result goes). */
export interface CallOptions {
  quiet?: boolean;
}

/**
 * Calls a server tool from the view and returns its structured content, and its text for the model.
 * A tool error is thrown as an Error with the message of the tool, also shown in the status bar.
 */
export async function callToolResult<T>(app: App, name: string, args: Args, options: CallOptions = {}): Promise<{ data: T; text: string }> {
  if (!options.quiet) setStatus(t("loading"), "loading");
  try {
    const result = (await app.callServerTool({ name, arguments: args })) as ToolResultLike;
    if (result.isError) throw new Error(textOf(result) || t("toolFailed", { name }));
    if (!result.structuredContent) throw new Error(t("noData", { name }));
    setStatus("");
    return { data: structuredData(result) as T, text: textOf(result) };
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), "error");
    throw e;
  }
}

/** Calls a server tool from the view and returns its structured content (see [callToolResult]). */
export async function callTool<T>(app: App, name: string, args: Args, options: CallOptions = {}): Promise<T> {
  return (await callToolResult<T>(app, name, args, options)).data;
}

/**
 * Tells the model what the view shows after a change made in the view, for the next turns (the host keeps the last
 * update only). Ignored by hosts without model context updates.
 */
export async function updateModelContext(app: App, text: string): Promise<void> {
  if (!app.getHostCapabilities()?.updateModelContext) return;
  try {
    await app.updateModelContext({ content: [{ type: "text", text }] });
  } catch {
    // update refused by the host: the view still works
  }
}
