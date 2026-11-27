import { Suspense, lazy, useEffect, useState, type SubmitEvent } from "react";
import { completeLogin, getKey, setKey as storeKey, startLogin } from "./openrouter";
import { DEFAULT_TITLE, loadConfig } from "./config";
import { language, t, useLanguage } from "./i18n";
import { LanguagePicker } from "./LanguagePicker";
import { ThemeButton } from "./ThemeButton";

// The chat (assistant-ui, MCP client, markdown) is loaded after the login only
const Chat = lazy(() => import("./Chat"));

interface Instance {
  title: string;
  legalPages: boolean;
}

/** Name of the instance and its legal pages (config.json): the defaults until loaded, or if it cannot be. */
function useInstance(): Instance {
  const [instance, setInstance] = useState<Instance>({ title: DEFAULT_TITLE, legalPages: false });
  useEffect(() => {
    loadConfig().then(
      (config) => setInstance({ title: config.title?.trim() || DEFAULT_TITLE, legalPages: config.legalPages === true }),
      () => {},
    );
  }, []);
  useEffect(() => {
    document.title = instance.title;
  }, [instance.title]);
  return instance;
}

function Login({ error, instance }: Readonly<{ error: string | null; instance: Instance }>) {
  const [pasted, setPasted] = useState("");
  const [invalid, setInvalid] = useState<string | null>(null);
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pasted.trim()) return;
    try {
      storeKey(pasted);
      window.location.reload();
    } catch (e) {
      setInvalid(e instanceof Error ? e.message : String(e));
    }
  };
  const message = invalid ?? error;
  return (
    <div className="login">
      <div className="login-settings">
        <ThemeButton />
        <LanguagePicker />
      </div>
      <h1 className="home-title">
        <img className="home-logo" src="/logo.svg" alt="" width={40} height={40} />
        <span>{instance.title}</span>
      </h1>
      <p className="home-tagline">{t("home.tagline")}</p>
      <p>
        {t("home.intro.before")}
        <a href="https://transitous.org/">Transitous</a>
        {t("home.intro.after")}
      </p>
      {/* the screenshot shows the English interface */}
      {language() === "en" && (
        <img className="home-screenshot" src="/home-journey.png" alt={t("home.screenshotAlt")} width={669} height={864} />
      )}
      <div>
        <p>{t("home.examples")}</p>
        <ul className="home-examples">
          <li>{t("home.example.departures")}</li>
          <li>{t("home.example.journey")}</li>
          <li>{t("home.example.reachable")}</li>
        </ul>
      </div>
      <h2>{t("home.how")}</h2>
      <ol className="home-steps">
        <li>
          {t("home.step1.before")}
          <a href="https://openrouter.ai/">OpenRouter</a>
          {t("home.step1.after", { button: t("login.button") })}
        </li>
        <li>{t("home.step2")}</li>
        <li>{t("home.step3")}</li>
      </ol>
      <p>{t("home.privacy")}</p>
      {message && <p className="login-error">{message}</p>}
      <button type="button" className="primary" onClick={() => void startLogin()}>
        {t("login.button")}
      </button>
      <form onSubmit={submit} className="login-key">
        <input
          type="password"
          placeholder={t("login.keyPlaceholder")}
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          autoComplete="off"
        />
        <button type="submit">{t("login.useKey")}</button>
      </form>
      <p className="home-attribution">
        {t("home.attribution.before")}
        <a href="https://transitous.org/sources/">{t("home.attribution.sources")}</a>
        {t("home.attribution.osm")}
        <a href="https://www.openstreetmap.org/copyright">{t("home.attribution.osmLink")}</a>
        {t("home.attribution.after")}
      </p>
      <p className="login-legal">
        {instance.legalPages && (
          <>
            <a href="/privacy.html">{t("legal.privacy")}</a> · <a href="/terms.html">{t("legal.terms")}</a> ·{" "}
          </>
        )}
        <a href="https://github.com/Litote/motis-mcp-app">{t("legal.source")}</a>
      </p>
    </div>
  );
}

export function App() {
  // the texts of the whole page follow the language chosen
  useLanguage();
  const [key, setKey] = useState(getKey);
  const [error, setError] = useState<string | null>(null);
  const instance = useInstance();

  useEffect(() => {
    completeLogin().then(
      (loggedIn) => loggedIn && setKey(getKey()),
      (e) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  return key ? (
    <Suspense fallback={<div className="loading">{t("loading")}</div>}>
      <Chat apiKey={key} />
    </Suspense>
  ) : (
    <Login error={error} instance={instance} />
  );
}
