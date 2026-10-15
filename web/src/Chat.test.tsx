// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ChatModelAdapter, ChatModelRunResult } from "@assistant-ui/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listModels: vi.fn(),
  getFreeQuota: vi.fn(),
  forgetKey: vi.fn(),
  connectMcp: vi.fn(),
  agentSettings: [] as { model(): string; fallbackModels(): string[]; onRunEnd?(): void }[],
  run: undefined as ChatModelAdapter["run"] | undefined,
}));

vi.mock("./openrouter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./openrouter")>()),
  listModels: mocks.listModels,
  getFreeQuota: mocks.getFreeQuota,
  forgetKey: mocks.forgetKey,
}));
vi.mock("./mcp", () => ({ connectMcp: mocks.connectMcp }));
vi.mock("./McpAppView", () => ({
  McpAppView: ({ toolName, onMessage }: { toolName: string; onMessage(text: string): void }) => (
    <button type="button" onClick={() => onMessage("More departures")}>
      view of {toolName}
    </button>
  ),
}));
vi.mock("./agent", () => ({
  createAgent: (settings: (typeof mocks.agentSettings)[number]): ChatModelAdapter => {
    mocks.agentSettings.push(settings);
    return {
      run: (options) => mocks.run?.(options) ?? defaultRun(),
    };
    async function* defaultRun(): AsyncGenerator<ChatModelRunResult> {
      yield {
        content: [
          { type: "text", text: "**Next** trains:" },
          {
            type: "tool-call",
            toolCallId: "c1",
            toolName: "departures",
            args: { stop: "Lyon" },
            argsText: '{"stop":"Lyon"}',
            result: { content: [{ type: "text", text: "12:04" }] },
          },
          {
            type: "tool-call",
            toolCallId: "c2",
            toolName: "trip_details",
            args: {},
            argsText: "",
            result: { content: [{ type: "text", text: "unknown trip" }], isError: true },
            isError: true,
          },
        ],
        status: { type: "complete", reason: "stop" },
      } as ChatModelRunResult;
      settings.onRunEnd?.();
    }
  },
}));

const { default: Chat } = await import("./Chat");

const MODELS = [
  { id: "nvidia/nemotron-3-super-120b-a12b:free", name: "Nemotron", free: true, created: 1 },
  { id: "meta/llama:free", name: "Llama", free: true, created: 1 },
  { id: "openrouter/free", name: "Router", free: true, created: 1 },
  { id: "openai/gpt-5", name: "GPT-5", free: false, created: 2_000_000_000 },
  { id: "openai/gpt-5-codex", name: "GPT-5 Codex", free: false, created: 2_000_000_000 },
];

beforeEach(() => {
  mocks.listModels.mockResolvedValue(MODELS);
  mocks.getFreeQuota.mockResolvedValue({ used: 3, limit: 50, remaining: 47 });
  mocks.connectMcp.mockResolvedValue({
    tools: new Map([
      ["departures", { name: "departures", _meta: { ui: { resourceUri: "ui://motis/departures.html" } } }],
      ["trip_details", { name: "trip_details" }],
    ]),
  });
  vi.stubGlobal(
    "ResizeObserver",
    vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    }),
  );
  Element.prototype.scrollTo = vi.fn();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mocks.agentSettings.length = 0;
  mocks.run = undefined;
});

describe("Chat", () => {
  it("shows the models, the free quota and the suggestions", async () => {
    render(<Chat apiKey="sk-or-v1-key" />);

    expect(await screen.findByText("47/50 free requests left")).toBeDefined();
    const picker = screen.getByLabelText("Model") as HTMLSelectElement;
    await waitFor(() => expect(picker.options.length).toBe(4));
    expect([...picker.options].map((o) => o.textContent)).toEqual(["Nemotron (recommended)", "Llama", "Router", "GPT-5"]);
    expect(screen.getByText("Next departures at Lyon Part-Dieu")).toBeDefined();
    // free models fall back on other free models
    expect(mocks.agentSettings[0].fallbackModels()).toEqual(["meta/llama:free"]);
  });

  it("selects a model, all models included", async () => {
    render(<Chat apiKey="sk-or-v1-key" />);
    const picker = screen.getByLabelText("Model") as HTMLSelectElement;
    await waitFor(() => expect(picker.options.length).toBe(4));

    fireEvent.click(screen.getByLabelText(/All models/));
    expect(picker.options.length).toBe(5);
    fireEvent.change(picker, { target: { value: "openai/gpt-5" } });

    expect(localStorage.getItem("openrouter-model")).toBe("openai/gpt-5");
    expect(mocks.agentSettings[0].model()).toBe("openai/gpt-5");
    expect(mocks.agentSettings[0].fallbackModels()).toEqual([]);
  });

  it("keeps a selected model missing from the list", async () => {
    localStorage.setItem("openrouter-model", "gone/model");
    render(<Chat apiKey="sk-or-v1-key" />);
    const picker = screen.getByLabelText("Model") as HTMLSelectElement;

    await waitFor(() => expect(picker.options.length).toBe(5));
    expect(picker.options[0].textContent).toBe("gone/model");
  });

  it("runs the agent: answer, tool calls with their view, errors", async () => {
    render(<Chat apiKey="sk-or-v1-key" />);

    fireEvent.click(screen.getByText("Next departures at Lyon Part-Dieu"));

    expect(await screen.findByText("Next")).toBeDefined();
    expect(screen.getByText("departures")).toBeDefined();
    expect(screen.getByText('{"stop":"Lyon"}')).toBeDefined();
    expect(screen.getByText("unknown trip")).toBeDefined();
    // the view sends a message to the thread
    fireEvent.click(await screen.findByText("view of departures"));
    expect(await screen.findByText("More departures")).toBeDefined();
    // the quota is refreshed after each run
    await waitFor(() => expect(mocks.getFreeQuota.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("shows a loader while waiting for the model", async () => {
    let answer!: () => void;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    mocks.run = async function* () {
      await answered;
      yield { content: [{ type: "text", text: "Done" }], status: { type: "complete", reason: "stop" } } as ChatModelRunResult;
    };
    render(<Chat apiKey="sk-or-v1-key" />);

    fireEvent.click(screen.getByText("Next departures at Lyon Part-Dieu"));

    expect(await screen.findByRole("status", { name: "Thinking…" })).toBeDefined();
    answer();
    expect(await screen.findByText("Done")).toBeDefined();
    expect(screen.queryByRole("status", { name: "Thinking…" })).toBeNull();
  });

  it("logs out", async () => {
    mocks.getFreeQuota.mockRejectedValue(new Error("offline"));
    mocks.listModels.mockRejectedValue(new Error("offline"));
    render(<Chat apiKey="sk-or-v1-key" />);

    fireEvent.click(screen.getByText("Log out"));

    expect(mocks.forgetKey).toHaveBeenCalled();
    expect(screen.queryByText(/free requests left/)).toBeNull();
  });
});
