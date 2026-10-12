// Test environment of the views: a fake MCP Apps host, and the browser APIs jsdom lacks (layout, canvas).
import { vi } from "vitest";
import { FakeApp } from "./host";

vi.mock("@modelcontextprotocol/ext-apps", () => ({
  App: FakeApp,
  applyDocumentTheme: (theme: string) => (document.documentElement.dataset.theme = theme),
  applyHostStyleVariables: vi.fn(),
  applyHostFonts: vi.fn(),
}));

vi.stubGlobal(
  "ResizeObserver",
  class {
    constructor(private readonly callback: () => void) {}
    observe() {
      this.callback();
    }
    disconnect() {}
  },
);
vi.stubGlobal("matchMedia", () => ({ matches: false }));

// Leaflet draws the markers on a canvas (preferCanvas): every drawing call is a no-op
const context = new Proxy({}, { get: (_, name) => (name === "canvas" ? document.createElement("canvas") : () => undefined) });
HTMLCanvasElement.prototype.getContext = (() => context) as unknown as typeof HTMLCanvasElement.prototype.getContext;
