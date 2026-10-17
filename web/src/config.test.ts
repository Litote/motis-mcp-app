import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CONFIG = { mcpUrl: "https://mcp.example/mcp", sandboxUrl: "https://sandbox.example/sandbox.html", hostOrigins: [] };

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadConfig", () => {
  it("fetches the configuration once", async () => {
    const fetchMock = vi.fn(async () => Response.json(CONFIG));
    vi.stubGlobal("fetch", fetchMock);
    const { loadConfig } = await import("./config");

    expect(await loadConfig()).toEqual(CONFIG);
    expect(await loadConfig()).toEqual(CONFIG);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("fetches the configuration again after a failure", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValue(Response.json(CONFIG));
    vi.stubGlobal("fetch", fetchMock);
    const { loadConfig } = await import("./config");

    await expect(loadConfig()).rejects.toThrow("Failed to fetch");
    await expect(loadConfig()).rejects.toThrow("config.json: HTTP 503");
    expect(await loadConfig()).toEqual(CONFIG);
  });
});
