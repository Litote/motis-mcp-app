import { afterEach, describe, expect, it } from "vitest";
import { language, locale, suggestions, t } from "./i18n";

const setLanguage = (value: string) => Object.defineProperty(globalThis.navigator, "language", { value, configurable: true });

describe("i18n", () => {
  afterEach(() => setLanguage("en-US"));

  it("follows the language of the browser", () => {
    setLanguage("fr-FR");
    expect(locale()).toBe("fr-FR");
    expect(language()).toBe("fr");
    expect(t("quota.left", { remaining: 3, limit: 50 })).toBe("3/50 requêtes gratuites restantes");
    expect(suggestions()[0]).toBe("Prochains départs à Lyon Part-Dieu");
  });

  it("falls back on English for the other languages", () => {
    setLanguage("de-DE");
    expect(language()).toBe("en");
    expect(t("error.openRouter", { status: 500 })).toBe("OpenRouter error (HTTP 500): {detail}");
    expect(suggestions()[0]).toBe("Next departures at Lyon Part-Dieu");
  });
});
