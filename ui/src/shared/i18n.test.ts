import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { language, resolveLanguage, setLocale, t, tOptional } from "./i18n";

// relative to ui/, the root of the tests (import.meta.url is not a file URL in jsdom)
const LOCALES = "src/shared/locales";
const read = (file: string): Record<string, string> => JSON.parse(readFileSync(join(LOCALES, file), "utf8"));

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
  afterEach(() => {
    setLocale(undefined);
    vi.unstubAllGlobals();
  });

  it("uses the locale of the host, else of the browser", () => {
    vi.stubGlobal("navigator", { language: "fr-CA" });
    expect(language()).toBe("fr");
    setLocale("en-US");
    expect(language()).toBe("en");
    expect(t("transfers", { count: 2 })).toBe("2 transfers");
    setLocale("fr-FR");
    expect(t("transfers", { count: 2 })).toBe("2 correspondances");
  });

  it("resolves the locale to a translated language, else to undefined", () => {
    expect(resolveLanguage("fr")).toBe("fr");
    expect(resolveLanguage("FR-be")).toBe("fr");
    expect(resolveLanguage("en-GB")).toBe("en");
    expect(resolveLanguage("de-AT")).toBe("de");
    expect(resolveLanguage("pt-BR")).toBe("pt");
    expect(resolveLanguage("pt-PT")).toBe("pt-PT");
    expect(resolveLanguage("no")).toBe("nb");
    expect(resolveLanguage("nb-NO")).toBe("nb");
    expect(resolveLanguage("tlh")).toBeUndefined();
    expect(resolveLanguage("not a locale")).toBeUndefined();
    expect(resolveLanguage(undefined)).toBeUndefined();
  });

  it("chooses the plural form of the count with the rules of the language", () => {
    setLocale("en");
    expect(t("transfers", { count: 0 })).toBe("0 transfers");
    expect(t("transfers", { count: 1 })).toBe("1 transfer");
    setLocale("fr");
    expect(t("transfers", { count: 0 })).toBe("0 correspondance");
    expect(t("transfers", { count: 1 })).toBe("1 correspondance");
    // French "many" (millions) falls back on "other"
    expect(t("transfers", { count: 1_000_000 })).toBe("1000000 correspondances");
    // Polish: one, few (2-4, 22-24…), many
    setLocale("pl");
    expect([1, 2, 5, 22, 25].map((count) => t("transfers", { count }))).toEqual([
      "1 przesiadka",
      "2 przesiadki",
      "5 przesiadek",
      "22 przesiadki",
      "25 przesiadek",
    ]);
  });

  it("falls back on English for the other languages, and keeps unknown placeholders", () => {
    setLocale("tlh");
    expect(language()).toBe("en");
    expect(t("track", {})).toBe("track {track}");
    expect(tOptional("mode.SUBWAY")).toBe("Metro");
    expect(tOptional("transfers")).toBe("{count} transfers");
    expect(tOptional("mode.UNKNOWN")).toBeUndefined();
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
