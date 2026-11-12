import { t } from "./i18n";
import { chooseTheme, chosenTheme, nextTheme, useTheme } from "./theme";

const ICONS = { system: "◐", light: "☀︎", dark: "☾" } as const;

/** Button switching the theme of the chat and of its views: system, light, dark. */
export function ThemeButton() {
  // re-rendered when the theme changes
  useTheme();
  const current = chosenTheme() ?? "system";
  const label = t("theme.title", { theme: t(`theme.${current}`) });
  return (
    <button
      type="button"
      className="theme-button"
      onClick={() => chooseTheme(nextTheme(chosenTheme()))}
      aria-label={label}
      title={label}
    >
      {ICONS[current]}
    </button>
  );
}
