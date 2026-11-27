// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ completeLogin: vi.fn(), startLogin: vi.fn(), loadConfig: vi.fn() }));

vi.mock("./openrouter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./openrouter")>()),
  completeLogin: mocks.completeLogin,
  startLogin: mocks.startLogin,
}));
vi.mock("./config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./config")>()),
  loadConfig: mocks.loadConfig,
}));
vi.mock("./Chat", () => ({ default: ({ apiKey }: { apiKey: string }) => <p>chat with {apiKey}</p> }));

const { App } = await import("./App");
const { chooseLanguage } = await import("./i18n");

const KEY = "sk-or-v1-0123abcd";

// no config.json by default (as in a test without a server): the defaults apply
beforeEach(() => {
  mocks.loadConfig.mockRejectedValue(new Error("config.json: HTTP 404"));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe("App", () => {
  it("asks for a key, then keeps a pasted one", async () => {
    mocks.completeLogin.mockResolvedValue(false);
    render(<App />);

    fireEvent.click(screen.getByText("Log in with OpenRouter"));
    expect(mocks.startLogin).toHaveBeenCalled();

    const input = screen.getByPlaceholderText(/paste an OpenRouter key/);
    fireEvent.submit(input.closest("form")!);
    expect(sessionStorage.getItem("openrouter-key")).toBeNull();

    fireEvent.change(input, { target: { value: "not a key" } });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByText("Not an OpenRouter key (sk-or-…).")).toBeDefined();

    fireEvent.change(input, { target: { value: KEY } });
    fireEvent.submit(input.closest("form")!);
    expect(sessionStorage.getItem("openrouter-key")).toBe(KEY);
  });

  it("opens the chat once back from the OpenRouter login", async () => {
    mocks.completeLogin.mockImplementation(async () => {
      sessionStorage.setItem("openrouter-key", KEY);
      return true;
    });
    render(<App />);

    expect(await screen.findByText(`chat with ${KEY}`)).toBeDefined();
  });

  it("names the instance and links its legal pages from its configuration", async () => {
    mocks.completeLogin.mockResolvedValue(false);
    mocks.loadConfig.mockResolvedValue({ title: "Errance", legalPages: true });
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Errance" })).toBeDefined();
    expect(document.title).toBe("Errance");
    expect(screen.getByText("Privacy").getAttribute("href")).toBe("/privacy.html");
    expect(screen.getByText("Terms of use").getAttribute("href")).toBe("/terms.html");
  });

  it("has a default name and no legal pages without configuration", async () => {
    mocks.completeLogin.mockResolvedValue(false);
    mocks.loadConfig.mockRejectedValue(new Error("config.json: HTTP 404"));
    render(<App />);

    await waitFor(() => expect(mocks.loadConfig).toHaveBeenCalled());
    expect(screen.getByRole("heading", { name: "MOTIS explorer" })).toBeDefined();
    expect(screen.queryByText("Privacy")).toBeNull();
    expect(screen.getByText("Source code (AGPL)")).toBeDefined();
  });

  it("credits Transitous and OpenStreetMap on the home page", () => {
    mocks.completeLogin.mockResolvedValue(false);
    render(<App />);

    expect(screen.getByText("Transitous and its sources").getAttribute("href")).toBe("https://transitous.org/sources/");
    expect(screen.getByText("© OpenStreetMap contributors").getAttribute("href")).toBe(
      "https://www.openstreetmap.org/copyright",
    );
    expect(screen.getByRole("img").getAttribute("src")).toBe("/home-journey.png");
  });

  it("shows the English screenshot only in English", async () => {
    mocks.completeLogin.mockResolvedValue(false);
    render(<App />);
    expect(screen.queryByRole("img")).not.toBeNull();

    await act(() => chooseLanguage("fr"));
    expect(screen.queryByRole("img")).toBeNull();
    await act(() => chooseLanguage(undefined));
  });

  it("shows the login errors", async () => {
    mocks.completeLogin.mockRejectedValue(new Error("Login expired: please try again."));
    render(<App />);

    expect(await screen.findByText("Login expired: please try again.")).toBeDefined();
  });

  it("opens the chat with a stored key", async () => {
    mocks.completeLogin.mockResolvedValue(false);
    sessionStorage.setItem("openrouter-key", KEY);
    render(<App />);

    expect(await screen.findByText(`chat with ${KEY}`)).toBeDefined();
  });
});
