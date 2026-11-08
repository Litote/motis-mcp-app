// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  chooseLanguage,
  chosenLanguage,
  language,
  languageName,
  languages,
  loadLanguage,
  locale,
  resolveLanguage,
  suggestions,
  t,
} from "./i18n";

// relative to web/, the root of the tests
const LOCALES = "src/locales";
const read = (file: string): Record<string, string> => JSON.parse(readFileSync(join(LOCALES, file), "utf8"));

const setLanguages = (...values: string[]) => {
  Object.defineProperty(globalThis.navigator, "language", { value: values[0], configurable: true });
  Object.defineProperty(globalThis.navigator, "languages", { value: values, configurable: true });
};

const PLURAL = /_(zero|one|two|few|many|other)$/;
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

/**
 * Problems of the translation [messages] of [lang] against English: missing or unknown keys, placeholders not those
 * of English (a plural form other than "other" may leave out {count}), plural forms of the integers missing, HTML
 * characters (the texts are inserted unescaped, also in attributes).
 */
function checkLocale(lang: string, messages: Record<string, string>, en: Record<string, string>): string[] {
  const problems: string[] = [];
  const rules = new Intl.PluralRules(lang);
  const categories = new Set(Array.from({ length: 200 }, (_, n) => rules.select(n)));
  const bases = new Set(Object.keys(en).map((k) => k.replace(PLURAL, "")));
  for (const base of bases) {
    const keys = `${base}_other` in en ? [...categories].map((c) => `${base}_${c}`) : [base];
    for (const key of keys) if (!(key in messages)) problems.push(`missing ${key}`);
  }
  for (const [key, text] of Object.entries(messages)) {
    const base = key.replace(PLURAL, "");
    const reference = en[key] ?? en[`${base}_other`];
    if (reference === undefined || (key !== base && !(`${base}_other` in en))) {
      problems.push(`unknown ${key}`);
      continue;
    }
    if (/[<>&"]/.test(text)) problems.push(`HTML character in ${key}`);
    const expected = placeholders(reference);
    const actual = placeholders(text);
    const optionalCount = key !== base && !key.endsWith("_other");
    const ok =
      actual.every((p) => expected.includes(p)) &&
      expected.every((p) => actual.includes(p) || (optionalCount && p === "count"));
    if (!ok) problems.push(`placeholders of ${key}: ${actual.join(",")} instead of ${expected.join(",")}`);
  }
  return problems;
}

describe("i18n", () => {
  afterEach(async () => {
    setLanguages("en-US", "en");
    await chooseLanguage(undefined);
  });

  it("shows English until the language of the browser is loaded", async () => {
    setLanguages("de-DE");
    expect(language()).toBe("de");
    expect(t("composer.send")).toBe("Send");
    await loadLanguage();
    expect(t("composer.send")).toBe("Senden");
  });

  it("follows the language of the browser", async () => {
    setLanguages("fr-FR");
    expect(locale()).toBe("fr-FR");
    expect(language()).toBe("fr");
    await loadLanguage();
    expect(t("quota.left", { count: 3, limit: 50 })).toBe("3/50 requêtes gratuites restantes");
    expect(t("quota.left", { count: 1, limit: 50 })).toBe("1/50 requête gratuite restante");
    expect(suggestions()[0]).toBe("Prochains départs à Lyon Part-Dieu");
  });

  it("takes the first translated language of the browser", () => {
    setLanguages("tlh", "fr-CH", "en");
    expect(locale()).toBe("fr-CH");
    expect(language()).toBe("fr");
    expect(resolveLanguage("tlh")).toBeUndefined();
  });

  it("falls back on English for the other languages", () => {
    setLanguages("tlh");
    expect(locale()).toBe("tlh");
    expect(language()).toBe("en");
    expect(t("error.openRouter", { status: 500 })).toBe("OpenRouter error (HTTP 500): {detail}");
    expect(t("quota.left", { count: 1, limit: 50 })).toBe("1/50 free request left");
    expect(suggestions()).toHaveLength(7);
    expect(suggestions()[0]).toBe("Next departures at Lyon Part-Dieu");
  });

  it("shows the language chosen by the user, whatever the language of the browser", async () => {
    setLanguages("fr-FR");
    await chooseLanguage("de");
    expect(chosenLanguage()).toBe("de");
    expect(language()).toBe("de");
    expect(locale()).toBe("de");
    expect(t("composer.send")).toBe("Senden");
    expect(document.documentElement.lang).toBe("de");
    expect(localStorage.getItem("language")).toBe("de");
  });

  it("keeps the region of the browser when the language chosen is the one of the browser", async () => {
    setLanguages("fr-CH");
    await chooseLanguage("fr");
    expect(locale()).toBe("fr-CH");
  });

  it("follows the browser again when the choice is cleared", async () => {
    setLanguages("fr-FR");
    await chooseLanguage("de");
    await chooseLanguage(undefined);
    expect(chosenLanguage()).toBeUndefined();
    expect(language()).toBe("fr");
    expect(localStorage.getItem("language")).toBeNull();
  });

  it("ignores a language that is not translated", async () => {
    await chooseLanguage("tlh");
    expect(chosenLanguage()).toBeUndefined();
    expect(language()).toBe("en");
  });

  it("names each language in this language", () => {
    expect(languages()).toContain("en");
    expect(languageName("de")).toBe("Deutsch");
    expect(languageName("fr")).toBe("Français");
  });

  const en = read("en.json");
  for (const file of readdirSync(LOCALES).filter((f) => f.endsWith(".json") && f !== "en.json")) {
    it(`has a complete and consistent translation in ${file}`, () => {
      const lang = file.slice(0, -".json".length);
      // the file is loaded, under a BCP 47 tag (a stale Vitest cache misses a new file: delete node_modules/.vitest-cache)
      expect(resolveLanguage(lang)).toBe(lang);
      expect(checkLocale(lang, read(file), en)).toEqual([]);
    });
  }
});
