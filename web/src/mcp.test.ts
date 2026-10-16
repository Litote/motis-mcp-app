import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tool } from "@modelcontextprotocol/client";

const client = vi.hoisted(() => ({
  connect: vi.fn(),
  listTools: vi.fn(),
  listResources: vi.fn(),
  getInstructions: vi.fn(),
  callTool: vi.fn(),
  readResource: vi.fn(),
}));

vi.mock("@modelcontextprotocol/client", () => ({
  Client: vi.fn(function () {
    return client;
  }),
  StreamableHTTPClientTransport: vi.fn(function (url: URL) {
    return { url };
  }),
}));

const tool = (name: string, meta?: Record<string, unknown>): Tool => ({ name, description: name, inputSchema: { type: "object" }, _meta: meta });

const TOOLS = [
  tool("departures", { ui: { resourceUri: "ui://motis/departures.html" } }),
  tool("explore_area", { "ui/resourceUri": "ui://motis/explorer.html" }),
  tool("app_only", { ui: { visibility: ["app"] } }),
  tool("search_places"),
];

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ mcpUrl: "https://mcp.example/mcp", sandboxUrl: "", hostOrigins: [] })));
  client.listTools.mockResolvedValue({ tools: TOOLS });
  client.listResources.mockResolvedValue({
    resources: [{ uri: "ui://motis/explorer.html", name: "explorer", _meta: { ui: { csp: { resourceDomains: ["https://tiles"] } } } }],
  });
  client.getInstructions.mockReturnValue("Use the tools.");
});

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe("connectMcp", () => {
  it("connects once to the configured server", async () => {
    const { connectMcp } = await import("./mcp");

    const server = await connectMcp();

    expect(await connectMcp()).toBe(server);
    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.connect.mock.calls[0][0].url.href).toBe("https://mcp.example/mcp");
    expect(server.instructions).toBe("Use the tools.");
    expect([...server.tools.keys()]).toEqual(["departures", "explore_area", "app_only", "search_places"]);
  });

  it("retries after a failure", async () => {
    const { connectMcp } = await import("./mcp");
    client.connect.mockRejectedValueOnce(new Error("offline"));

    await expect(connectMcp()).rejects.toThrow("offline");
    await expect(connectMcp()).resolves.toBeDefined();
  });

  it("fails without configuration", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    const { connectMcp } = await import("./mcp");

    await expect(connectMcp()).rejects.toThrow("config.json: HTTP 404");
  });
});

describe("tools", () => {
  it("offers the model the tools not reserved to the views", async () => {
    const { connectMcp, modelTools } = await import("./mcp");
    const tools = modelTools(await connectMcp());

    expect(tools.map((t) => t.function.name)).toEqual(["departures", "explore_area", "search_places"]);
    expect(tools[0]).toEqual({ type: "function", function: { name: "departures", description: "departures", parameters: { type: "object" } } });
  });

  it("calls the tools, errors included", async () => {
    const { callTool, connectMcp, resultText } = await import("./mcp");
    const server = await connectMcp();
    client.callTool.mockResolvedValueOnce({ content: [{ type: "text", text: "ok" }, { type: "image", data: "", mimeType: "image/png" }] });

    const result = await callTool(server, "departures", { stop: "Lyon" });

    expect(client.callTool).toHaveBeenCalledWith({ name: "departures", arguments: { stop: "Lyon" } }, { signal: undefined });
    const signal = new AbortController().signal;
    await callTool(server, "departures", {}, signal);
    expect(client.callTool).toHaveBeenLastCalledWith({ name: "departures", arguments: {} }, { signal });
    expect(resultText(result)).toBe("ok\n[image]");

    expect(await callTool(server, "unknown", {})).toEqual({ content: [{ type: "text", text: "Unknown tool: unknown" }], isError: true });

    client.callTool.mockRejectedValueOnce(new Error("timeout"));
    expect(await callTool(server, "departures", {})).toEqual({ content: [{ type: "text", text: "Tool call failed: timeout" }], isError: true });
  });
});

describe("toolView", () => {
  it("reads the view of a tool once, with the metadata of the content or of the listing", async () => {
    const { connectMcp, toolView } = await import("./mcp");
    const server = await connectMcp();
    client.readResource.mockImplementation(async ({ uri }: { uri: string }) => ({
      contents:
        uri === "ui://motis/departures.html"
          ? [{ uri, mimeType: "text/html;profile=mcp-app", text: "<html>departures</html>", _meta: { ui: { permissions: { geolocation: {} } } } }]
          : [{ uri, mimeType: "text/html;profile=mcp-app", blob: btoa("<html>explorer</html>") }],
    }));

    const departures = await toolView(server, "departures");
    expect(departures).toEqual({ html: "<html>departures</html>", csp: undefined, permissions: { geolocation: {} } });
    expect(await toolView(server, "departures")).toBe(departures);
    expect(client.readResource).toHaveBeenCalledOnce();

    expect(await toolView(server, "explore_area")).toEqual({ html: "<html>explorer</html>", csp: { resourceDomains: ["https://tiles"] }, permissions: undefined });
    expect(toolView(server, "search_places")).toBeUndefined();
  });

  it("rejects resources that are not views, and reads them again later", async () => {
    const { connectMcp, toolView } = await import("./mcp");
    const server = await connectMcp();
    client.readResource.mockResolvedValue({ contents: [{ uri: "ui://motis/departures.html", mimeType: "text/html", text: "" }] });

    await expect(toolView(server, "departures")).rejects.toThrow("Not an MCP App view: ui://motis/departures.html");
    await expect(toolView(server, "departures")).rejects.toThrow();
    expect(client.readResource).toHaveBeenCalledTimes(2);
  });
});

describe("toolUiResourceUri", () => {
  it("rejects URIs that are not ui://", async () => {
    const { toolUiResourceUri } = await import("./mcp-apps");
    expect(() => toolUiResourceUri(tool("x", { ui: { resourceUri: "https://evil" } }))).toThrow("Invalid UI resource URI");
  });
});
