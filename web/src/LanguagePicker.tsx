/** Language of the chat and of the views: the language of the browser, or one chosen by the user (remembered). */
import { chooseLanguage, chosenLanguage, languageName, languages, t, useLanguage } from "./i18n";

const BROWSER = "";

export function LanguagePicker() {
  useLanguage();
  return (
    <select
      className="language-picker"
      value={chosenLanguage() ?? BROWSER}
      onChange={(e) => void chooseLanguage(e.target.value || undefined)}
      aria-label={t("language.label")}
      title={t("language.label")}
    >
      <option value={BROWSER}>{t("language.browser")}</option>
      {languages().map((tag) => (
        <option key={tag} value={tag} lang={tag}>
          {languageName(tag)}
        </option>
      ))}
    </select>
  );
}
