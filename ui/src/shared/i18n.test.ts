import { afterEach, describe, expect, it, vi } from "vitest";
import { language, setLocale, t, tOptional } from "./i18n";

describe("i18n", () => {
  afterEach(() => {
    setLocale(undefined);
    vi.unstubAllGlobals();
  });

  it("uses the locale of the host, else of the browser", () => {
    vi.stubGlobal("navigator", { language: "fr-CA" });
    expect(language()).toBe("fr");
    setLocale("en-US");
    expect(language()).toBe("en");
    expect(t("transfers", { count: 2 })).toBe("2 transfer(s)");
    setLocale("fr-FR");
    expect(t("transfers", { count: 2 })).toBe("2 correspondance(s)");
  });

  it("falls back on English for the other languages, and keeps unknown placeholders", () => {
    setLocale("de-DE");
    expect(t("track", {})).toBe("track {track}");
    expect(tOptional("mode.SUBWAY")).toBe("Metro");
    expect(tOptional("mode.UNKNOWN")).toBeUndefined();
  });
});
