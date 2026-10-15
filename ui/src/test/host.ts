// Fake host of the views (App of @modelcontextprotocol/ext-apps), and loading of a view in the jsdom document.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { vi } from "vitest";

type Handler = (params: Record<string, unknown>) => void;

export class FakeApp {
  static last: FakeApp;
  /** The next view fails to connect to the host. */
  static failNextConnection = false;
  /** Locale of the host of the next view. */
  static nextLocale = "en-GB";
  ontoolinput?: Handler;
  ontoolresult?: Handler;
  ontoolcancelled?: () => void;
  onhostcontextchanged?: Handler;
  hostContext: Record<string, unknown> | undefined = {
    theme: "dark",
    locale: FakeApp.nextLocale,
    availableDisplayModes: ["inline", "fullscreen"],
    displayMode: "inline",
    styles: { variables: { "--color-text-primary": "#000" }, css: { fonts: "@font-face {}" } },
    safeAreaInsets: { top: 1, right: 2, bottom: 3, left: 4 },
  };
  hostCapabilities: Record<string, unknown> | undefined = { serverTools: {}, updateModelContext: { text: {} } };
  connect = vi.fn(async () => undefined);
  callServerTool = vi.fn();
  updateModelContext = vi.fn(async (_params: { content: Array<{ type: string; text: string }> }) => ({}));
  requestDisplayMode = vi.fn(async ({ mode }: { mode: string }) => ({ mode }));

  constructor() {
    FakeApp.last = this;
    FakeApp.nextLocale = "en-GB";
    if (FakeApp.failNextConnection) {
      FakeApp.failNextConnection = false;
      this.connect.mockRejectedValue(new Error("no host"));
    }
  }

  getHostContext() {
    return this.hostContext;
  }

  getHostCapabilities() {
    return this.hostCapabilities;
  }

  /** The host sends the arguments, then the result of the tool call. */
  async toolResult(args: Record<string, unknown>, structuredContent: unknown): Promise<void> {
    this.ontoolinput?.({ arguments: args });
    this.ontoolresult?.({ content: [{ type: "text", text: "summary" }], structuredContent });
    await Promise.resolve();
  }

  /** Answers the next server tool calls of the view with [results]. */
  answer(...results: unknown[]): void {
    for (const structuredContent of results) {
      this.callServerTool.mockResolvedValueOnce(
        structuredContent instanceof Error
          ? { content: [{ type: "text", text: structuredContent.message }], isError: true }
          : { content: [], structuredContent },
      );
    }
  }
}

export function fixture<T = Record<string, unknown>>(name: string): T {
  return JSON.parse(readFileSync(resolve("src/test", `${name}.json`), "utf8")) as T;
}

/** Loads the body of src/<view>.html, then runs the script of the view: returns its host. */
export async function loadView(view: string): Promise<FakeApp> {
  const html = readFileSync(resolve("src", `${view}.html`), "utf8");
  document.head.innerHTML = "";
  document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
  vi.resetModules();
  await import(`../${view}.ts`);
  await Promise.resolve();
  return FakeApp.last;
}

/** Waits for the pending promises (tool calls of the view). */
export const flush = () => new Promise((resolve) => setTimeout(resolve));

export const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
