// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ completeLogin: vi.fn(), startLogin: vi.fn() }));

vi.mock("./openrouter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./openrouter")>()),
  completeLogin: mocks.completeLogin,
  startLogin: mocks.startLogin,
}));
vi.mock("./Chat", () => ({ default: ({ apiKey }: { apiKey: string }) => <p>chat with {apiKey}</p> }));

const { App } = await import("./App");

const KEY = "sk-or-v1-0123abcd";

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
