// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Tool } from "@modelcontextprotocol/client";

const mocks = vi.hoisted(() => ({ connectMcp: vi.fn(), callTool: vi.fn() }));

vi.mock("./mcp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./mcp")>()),
  connectMcp: mocks.connectMcp,
  callTool: mocks.callTool,
}));
vi.mock("./McpAppView", () => ({
  McpAppView: ({ toolName, onMessage }: { toolName: string; onMessage(text: string): void }) => (
    <button type="button" onClick={() => onMessage("hello")}>
      view of {toolName}
    </button>
  ),
}));

const { DevHost, EXAMPLES, initialArgs } = await import("./DevHost");

const departures: Tool = {
  name: "departures",
  description: "Next departures",
  inputSchema: {
    type: "object",
    properties: { stopId: { type: "string", examples: ["stop-1"] }, n: { type: "number", default: 10 } },
    required: ["stopId", "n", "time"],
  },
  _meta: { ui: { resourceUri: "ui://departures" } },
};
const geocode: Tool = { name: "geocode", inputSchema: { type: "object" } };

function server() {
  mocks.connectMcp.mockResolvedValue({
    client: {},
    instructions: "",
    tools: new Map([
      ["geocode", geocode],
      ["departures", departures],
    ]),
    resources: new Map(),
  });
}

const call = () => fireEvent.click(screen.getByText("Call (Ctrl+Enter)"));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("initialArgs", () => {
  it("gives the example arguments of the tool", () => {
    expect(JSON.parse(initialArgs(departures))).toEqual(EXAMPLES.departures);
  });

  it("gives the required arguments of a tool without example, with their default or example value", () => {
    expect(JSON.parse(initialArgs({ ...departures, name: "other" }))).toEqual({ stopId: "stop-1", n: 10, time: "" });
    expect(initialArgs(geocode)).toBe("{}");
  });

  it("gives the arguments last sent", () => {
    localStorage.setItem("dev-args:geocode", '{"text":"Lyon"}');
    expect(initialArgs(geocode)).toBe('{"text":"Lyon"}');
  });
});

describe("DevHost", () => {
  it("calls the tool with the typed arguments and renders its view", async () => {
    server();
    mocks.callTool.mockResolvedValue({ content: [{ type: "text", text: "3 departures" }] });
    render(<DevHost />);

    const args = await screen.findByLabelText<HTMLTextAreaElement>("Arguments");
    expect(screen.getByText("Next departures")).toBeDefined();
    fireEvent.change(args, { target: { value: '{"stopId":"s"}' } });
    call();

    fireEvent.click(await screen.findByText("view of departures"));
    expect(mocks.callTool).toHaveBeenCalledWith(expect.anything(), "departures", { stopId: "s" });
    expect(localStorage.getItem("dev-args:departures")).toBe('{"stopId":"s"}');
    expect(screen.getByText("ui/message: hello")).toBeDefined();
  });

  it("shows the errors of the tool, without view", async () => {
    server();
    mocks.callTool.mockResolvedValue({ content: [{ type: "text", text: "Unknown stop" }], isError: true });
    render(<DevHost />);

    fireEvent.change(await screen.findByLabelText("Tool"), { target: { value: "geocode" } });
    fireEvent.keyDown(screen.getByLabelText("Arguments"), { key: "Enter", ctrlKey: true });

    expect((await screen.findAllByText("Unknown stop")).length).toBeGreaterThan(0);
    expect(screen.queryByText(/view of/)).toBeNull();
  });

  it("restores the example arguments", async () => {
    server();
    render(<DevHost />);

    const args = await screen.findByLabelText<HTMLTextAreaElement>("Arguments");
    fireEvent.change(args, { target: { value: '{"stopId":"s"}' } });
    fireEvent.click(screen.getByText("Example"));

    expect(JSON.parse(args.value)).toEqual(EXAMPLES.departures);
  });

  it("refuses invalid JSON", async () => {
    server();
    render(<DevHost />);

    fireEvent.change(await screen.findByLabelText("Arguments"), { target: { value: "{" } });
    call();

    expect(await screen.findByText(/Invalid JSON/)).toBeDefined();
    expect(mocks.callTool).not.toHaveBeenCalled();
  });

  it("tells when the server is unavailable", async () => {
    mocks.connectMcp.mockRejectedValue(new Error("fetch failed"));
    render(<DevHost />);

    expect(await screen.findByText("MCP server unavailable: fetch failed")).toBeDefined();
  });
});
