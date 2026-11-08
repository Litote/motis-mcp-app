// Texts of the views, in the locale of the host (hostContext.locale), else of the browser.
// One flat JSON file per language in locales/ (i18next JSON v4 format: `key_one`, `key_other`… for the plural
// forms of Intl.PluralRules, chosen by the `count` value). A text missing in a language falls back on English.
// Adding a language is adding its file, named by its BCP 47 tag (`pt.json`, `zh-Hans.json`…).
import en from "./locales/en.json";

type Messages = Record<string, string>;

const MESSAGES: Record<string, Messages> = Object.fromEntries(
  Object.entries(import.meta.glob<Messages>("./locales/*.json", { eager: true, import: "default" })).map(
    ([path, messages]) => [path.slice("./locales/".length, -".json".length), messages],
  ),
);

type PluralSuffix = "_zero" | "_one" | "_two" | "_few" | "_many" | "_other";
type BaseKey<K> = K extends `${infer B}${PluralSuffix}` ? B : K;
export type MessageKey = BaseKey<keyof typeof en>;

let locale: string | undefined;

/** Locale of the host (hostContext.locale), or of the browser until the host gives one. */
export const hostLocale = (): string | undefined => locale ?? globalThis.navigator?.language;

/**
 * Sets the locale of the host. The static texts are translated again only when the language changes: they are
 * replaced by the data once a result is rendered (titles).
 */
export function setLocale(value: string | undefined): void {
  const previous = language();
  locale = value;
  if (language() !== previous) translateDocument();
}

/** Languages translated under another tag: Norwegian (`no`) is translated in Bokmål (`nb`). */
const LANGUAGE_ALIASES: Record<string, string> = { no: "nb" };

/**
 * Supported language of the locale [tag]: the locale itself, else its language and script (zh-TW → zh-Hant), else
 * its language (pt-BR → pt); undefined if none is translated.
 */
export function resolveLanguage(tag: string | undefined): string | undefined {
  if (!tag) return undefined;
  let candidates: string[];
  try {
    const parsed = new Intl.Locale(tag);
    const { script } = parsed.maximize();
    candidates = [parsed.baseName, `${parsed.language}-${script}`, parsed.language, LANGUAGE_ALIASES[parsed.language]];
  } catch {
    return undefined;
  }
  const languages = Object.keys(MESSAGES);
  for (const candidate of candidates) {
    if (!candidate) continue;
    const found = languages.find((l) => l.toLowerCase() === candidate.toLowerCase());
    if (found) return found;
  }
  return undefined;
}

export const language = (): string => resolveLanguage(hostLocale()) ?? "en";

const pluralRules = new Map<string, Intl.PluralRules>();

function pluralCategory(lang: string, count: number): Intl.LDMLPluralRule {
  let rules = pluralRules.get(lang);
  if (!rules) pluralRules.set(lang, (rules = new Intl.PluralRules(lang)));
  return rules.select(count);
}

/** Text of [key] in [lang], in the plural form of [count] when the text has plural forms. */
function message(lang: string, key: string, count: unknown): string | undefined {
  const messages = MESSAGES[lang];
  const plural = typeof count === "number" ? messages[`${key}_${pluralCategory(lang, count)}`] : undefined;
  return plural ?? messages[`${key}_other`] ?? messages[key];
}

/**
 * Text of [key], `{name}` placeholders replaced by [values] (not escaped). A numeric `count` value chooses the
 * plural form.
 */
export function t(key: MessageKey, values: Record<string, string | number> = {}): string {
  const text = message(language(), key, values.count) ?? message("en", key, values.count) ?? key;
  return text.replaceAll(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}

/** Text of [key] if it exists, else undefined (keys built from data: modes, form factors…). */
export function tOptional(key: string): string | undefined {
  return key in en || `${key}_other` in en ? t(key as MessageKey) : undefined;
}

/** Translates the static texts: `data-i18n` (text content) and `data-i18n-title` (title) attributes. */
export function translateDocument(): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = language();
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n as MessageKey);
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle as MessageKey);
  });
}
