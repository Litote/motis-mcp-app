// Texts of the chat, in the language chosen by the user (stored in the browser), else in the first language of the
// browser that is translated.
// One flat JSON file per language in locales/ (i18next JSON v4 format: `key_one`, `key_other`… for the plural
// forms of Intl.PluralRules, chosen by the `count` value). A text missing in a language falls back on English.
// Adding a language is adding its file, named by its BCP 47 tag (`pt.json`, `zh-Hans.json`…).
// Same mechanism as the views (ui/src/shared/i18n.ts), which are built apart. Unlike the views (single files), the
// chat loads only the language shown (loadLanguage, before the first render, or chooseLanguage): one chunk per
// language, English in the main bundle as the fallback.
import { useSyncExternalStore } from "react";
import en from "./locales/en.json";

type Messages = Record<string, string>;

const tagOf = (path: string): string => path.slice("./locales/".length, -".json".length);

/** Loaders of the translations other than English, by language tag. */
const LOADERS: Record<string, () => Promise<Messages>> = Object.fromEntries(
  Object.entries(import.meta.glob<Messages>(["./locales/*.json", "!./locales/en.json"], { import: "default" })).map(
    ([path, load]) => [tagOf(path), load],
  ),
);

/** Translated languages. */
const LANGUAGES = ["en", ...Object.keys(LOADERS)];

/** Loaded translations, by language tag. */
const MESSAGES: Record<string, Messages> = { en };

type PluralSuffix = "_zero" | "_one" | "_two" | "_few" | "_many" | "_other";
type BaseKey<K> = K extends `${infer B}${PluralSuffix}` ? B : K;
export type MessageKey = BaseKey<keyof typeof en>;

/** Suggestions of the empty thread: one per tool rendered by a view (see docs/MCP-SERVER.md). */
const SUGGESTIONS = ["departures", "itinerary", "lines", "rentals", "route", "reachable", "trip"] as const;

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
  for (const candidate of candidates) {
    if (!candidate) continue;
    const found = LANGUAGES.find((l) => l.toLowerCase() === candidate.toLowerCase());
    if (found) return found;
  }
  return undefined;
}

/** Translated languages, by tag. */
export const languages = (): readonly string[] => LANGUAGES;

/** Name of the language [tag] in this language ("Deutsch", "Français"…), else the tag. */
export function languageName(tag: string): string {
  try {
    const name = new Intl.DisplayNames([tag], { type: "language" }).of(tag);
    if (name) return name.charAt(0).toLocaleUpperCase(tag) + name.slice(1);
  } catch {
    // no display names: the tag
  }
  return tag;
}

const LANGUAGE_STORAGE = "language";

function storedLanguage(): string | undefined {
  try {
    return resolveLanguage(localStorage.getItem(LANGUAGE_STORAGE) ?? undefined);
  } catch {
    return undefined;
  }
}

/** Language chosen by the user, undefined to follow the browser. */
let chosen = storedLanguage();

export const chosenLanguage = (): string | undefined => chosen;

/** The first locale of the browser in a translated language, else its first locale. */
function browserLocale(): string {
  const nav = globalThis.navigator;
  const preferred = nav?.languages?.length ? nav.languages : [nav?.language ?? "en"];
  return preferred.find((l) => resolveLanguage(l)) ?? preferred[0];
}

/**
 * Locale of the chat, also given to the views (hostContext.locale): the locale of the browser, unless the user chose
 * another language (the chosen language then, without region).
 */
export function locale(): string {
  const browser = browserLocale();
  return !chosen || resolveLanguage(browser) === chosen ? browser : chosen;
}

export const language = (): string => resolveLanguage(locale()) ?? "en";

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Language of the texts, re-rendering the component when the user chooses another one. */
export const useLanguage = (): string => useSyncExternalStore(subscribe, language);

/**
 * Shows the texts in the language [tag], or in the language of the browser when undefined, and remembers the choice in
 * the browser. The translation is loaded first: the texts change once, from the old language to the new one.
 */
export async function chooseLanguage(tag: string | undefined): Promise<void> {
  const resolved = resolveLanguage(tag);
  try {
    if (resolved) localStorage.setItem(LANGUAGE_STORAGE, resolved);
    else localStorage.removeItem(LANGUAGE_STORAGE);
  } catch {
    // storage unavailable (private window…): chosen for this page only
  }
  // loaded before it is shown: a render meanwhile stays in the old language, not in English
  await loadLanguage(resolved ?? resolveLanguage(browserLocale()) ?? "en");
  chosen = resolved;
  if (globalThis.document) document.documentElement.lang = language();
  for (const listener of listeners) listener();
}

/**
 * Loads the translation of the language shown, before the first render. Until then, and if it fails, the texts are
 * in English.
 */
export async function loadLanguage(lang = language()): Promise<void> {
  if (lang in MESSAGES) return;
  try {
    MESSAGES[lang] = await LOADERS[lang]();
  } catch (error) {
    console.warn(`Translation ${lang} unavailable, texts in English`, error);
  }
}

const pluralRules = new Map<string, Intl.PluralRules>();

function pluralCategory(lang: string, count: number): Intl.LDMLPluralRule {
  let rules = pluralRules.get(lang);
  if (!rules) {
    rules = new Intl.PluralRules(lang);
    pluralRules.set(lang, rules);
  }
  return rules.select(count);
}

/** Text of [key] in [lang], in the plural form of [count] when the text has plural forms. */
function message(lang: string, key: string, count: unknown): string | undefined {
  const messages = MESSAGES[lang];
  if (!messages) return undefined;
  const plural = typeof count === "number" ? messages[`${key}_${pluralCategory(lang, count)}`] : undefined;
  return plural ?? messages[`${key}_other`] ?? messages[key];
}

/** Text of [key], `{name}` placeholders replaced by [values]. A numeric `count` value chooses the plural form. */
export function t(key: MessageKey, values: Record<string, string | number> = {}): string {
  const text = message(language(), key, values.count) ?? message("en", key, values.count) ?? key;
  return text.replaceAll(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}

export const suggestions = (): string[] => SUGGESTIONS.map((name) => t(`suggestion.${name}`));
