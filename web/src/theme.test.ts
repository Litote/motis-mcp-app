// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { chooseTheme, chosenTheme, nextTheme, theme } from "./theme";

describe("theme", () => {
  afterEach(() => chooseTheme(undefined));

  it("cycles system, light, dark", () => {
    expect(nextTheme(undefined)).toBe("light");
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBeUndefined();
  });

  it("applies and remembers the chosen theme", () => {
    chooseTheme("dark");
    expect(theme()).toBe("dark");
    expect(chosenTheme()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  it("follows the system when no theme is chosen", () => {
    chooseTheme("light");
    chooseTheme(undefined);
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem("theme")).toBeNull();
  });
});
