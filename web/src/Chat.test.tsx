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
const { DEFAULT_MODEL } = await import("./openrouter");
const { chooseLanguage } = await import("./i18n");

const MODELS = [
  { id: "nvidia/nemotron-3.5-super-vl:free", name: "Nemotron", free: true, created: 1 },
  { id: "nvidia/nemotron-3-ultra-550b-a55b:free", name: "Nemotron Ultra", free: true, created: 1 },
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

afterEach(async () => {
  cleanup();
  await chooseLanguage(undefined);
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
    await waitFor(() => expect(picker.options.length).toBe(5));
    expect([...picker.options].map((o) => o.textContent)).toEqual(["Nemotron (recommended)", "Nemotron Ultra", "Llama", "Router", "GPT-5"]);
    expect(screen.getByText("Next departures at Lyon Part-Dieu")).toBeDefined();
    // free models fall back on the free models reliable with the tools
    expect(mocks.agentSettings[0].fallbackModels()).toEqual(["nvidia/nemotron-3-ultra-550b-a55b:free"]);
  });

  it("selects a model, all models included", async () => {
    render(<Chat apiKey="sk-or-v1-key" />);
    const picker = screen.getByLabelText("Model") as HTMLSelectElement;
    await waitFor(() => expect(picker.options.length).toBe(5));

    fireEvent.click(screen.getByLabelText(/All models/));
    expect(picker.options.length).toBe(6);
    fireEvent.change(picker, { target: { value: "openai/gpt-5" } });

    expect(localStorage.getItem("openrouter-model")).toBe("openai/gpt-5");
    expect(mocks.agentSettings[0].model()).toBe("openai/gpt-5");
    expect(mocks.agentSettings[0].fallbackModels()).toEqual([]);
    // another free model falls back on the default one first
    fireEvent.change(picker, { target: { value: "meta/llama:free" } });
    expect(mocks.agentSettings[0].fallbackModels()).toEqual([
      "nvidia/nemotron-3.5-super-vl:free",
      "nvidia/nemotron-3-ultra-550b-a55b:free",
    ]);
  });

  it("keeps a selected model missing from the list", async () => {
    localStorage.setItem("openrouter-model", "gone/model");
    render(<Chat apiKey="sk-or-v1-key" />);
    const picker = screen.getByLabelText("Model") as HTMLSelectElement;

    await waitFor(() => expect(picker.options.length).toBe(6));
    expect(picker.options[0].textContent).toBe("gone/model");
  });

  it("runs the agent: answer, tool calls with their view, errors", async () => {
    render(<Chat apiKey="sk-or-v1-key" />);

    fireEvent.click(screen.getByText("Next departures at Lyon Part-Dieu"));

    expect(await screen.findByText("Next")).toBeDefined();
    expect(screen.getByText("departures")).toBeDefined();
    expect(screen.getByText('{"stop":"Lyon"}')).toBeDefined();
    // a tool error stays in the collapsed details instead of being shown in red
    expect(document.querySelector(".tool-error")).toBeNull();
    expect(document.body.textContent).toContain("unknown trip");
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

  it("shows the models that answered", async () => {
    mocks.run = async function* () {
      yield {
        content: [{ type: "text", text: "Done" }],
        status: { type: "complete", reason: "stop" },
        metadata: { custom: { models: ["a/first:free", "b/fallback:free"] } },
      } as ChatModelRunResult;
    };
    render(<Chat apiKey="sk-or-v1-key" />);

    fireEvent.click(screen.getByText("Next departures at Lyon Part-Dieu"));

    expect(await screen.findByText("a/first:free → b/fallback:free")).toBeDefined();
  });

  it("exports the conversation in Markdown, to the clipboard or else as a file", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<Chat apiKey="sk-or-v1-key" />);
    const button = screen.getByText("Export") as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.click(screen.getByText("Next departures at Lyon Part-Dieu"));
    expect(await screen.findByText("Next")).toBeDefined();
    fireEvent.click(button);

    expect(await screen.findByText("Copied ✓")).toBeDefined();
    const markdown = writeText.mock.calls[0][0] as string;
    expect(markdown).toContain(`- Model: \`${DEFAULT_MODEL}\``);
    expect(markdown).toContain("### User\n\nNext departures at Lyon Part-Dieu");
    expect(markdown).toContain("<details><summary>Tool <code>trip_details</code> (error)</summary>");

    // clipboard refused: downloaded
    writeText.mockRejectedValue(new Error("denied"));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    URL.createObjectURL = vi.fn(() => "blob:conversation");
    URL.revokeObjectURL = vi.fn();
    await waitFor(() => expect(screen.getByText("Export")).toBeDefined(), { timeout: 3000 });
    fireEvent.click(screen.getByText("Export"));
    expect(await screen.findByText("Downloaded ✓")).toBeDefined();
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  it("changes the language of the texts, the conversation kept", async () => {
    render(<Chat apiKey="sk-or-v1-key" />);
    fireEvent.click(screen.getByText("Next departures at Lyon Part-Dieu"));
    expect(await screen.findByText("Next")).toBeDefined();
    await waitFor(() => expect(screen.getByText("Send")).toBeDefined());

    const picker = screen.getByLabelText("Language") as HTMLSelectElement;
    expect(picker.value).toBe("");
    expect([...picker.options].find((o) => o.value === "de")?.textContent).toBe("Deutsch");
    fireEvent.change(picker, { target: { value: "fr" } });

    expect(await screen.findByText("Envoyer")).toBeDefined();
    expect(screen.getByText("Se déconnecter")).toBeDefined();
    expect(screen.getByText("Next")).toBeDefined();
    expect(localStorage.getItem("language")).toBe("fr");
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
