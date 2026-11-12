// Theme of the chat (light or dark): the one chosen by the user (stored in the browser), else the one of the system.
// Applied to the page (`data-theme` on the root element, read by styles.css) and given to the views
// (hostContext.theme), which follow its changes.
import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

/** Theme chosen by the user, undefined to follow the system. */
export type ThemeChoice = Theme | undefined;

const THEME_STORAGE = "theme";

function storedTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(THEME_STORAGE);
    return value === "light" || value === "dark" ? value : undefined;
  } catch {
    return undefined;
  }
}

let chosen = storedTheme();

export const chosenTheme = (): ThemeChoice => chosen;

const systemDark = (): boolean => globalThis.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false;

/** Theme shown: the one chosen, else the one of the system. */
export const theme = (): Theme => chosen ?? (systemDark() ? "dark" : "light");

/** Applies the chosen theme to the page; following the system, the CSS media query applies. */
export function applyTheme(): void {
  if (!globalThis.document) return;
  const root = document.documentElement;
  if (chosen) root.dataset.theme = chosen;
  else delete root.dataset.theme;
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // the theme of the system can change while the page is open (automatic dark mode at night…)
  const query = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
  query?.addEventListener?.("change", listener);
  return () => {
    listeners.delete(listener);
    query?.removeEventListener?.("change", listener);
  };
}

/** Theme shown, re-rendering the component when the user chooses another one or the system one changes. */
export const useTheme = (): Theme => useSyncExternalStore(subscribe, theme);

/** Shows the page in the theme [choice], or in the one of the system when undefined, and remembers the choice. */
export function chooseTheme(choice: ThemeChoice): void {
  try {
    if (choice) localStorage.setItem(THEME_STORAGE, choice);
    else localStorage.removeItem(THEME_STORAGE);
  } catch {
    // storage unavailable (private window…): chosen for this page only
  }
  chosen = choice;
  applyTheme();
  notify();
}

/** Next choice of the theme button: system, light, dark, then system again. */
export function nextTheme(choice: ThemeChoice): ThemeChoice {
  if (!choice) return "light";
  return choice === "light" ? "dark" : undefined;
}
