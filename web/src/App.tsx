import { Suspense, lazy, useEffect, useState, type SubmitEvent } from "react";
import { completeLogin, getKey, setKey as storeKey, startLogin } from "./openrouter";
import { t } from "./i18n";

// The chat (assistant-ui, MCP client, markdown) is loaded after the login only
const Chat = lazy(() => import("./Chat"));

function Login({ error }: Readonly<{ error: string | null }>) {
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
      <h2>{t("login.title")}</h2>
      <p>
        {t("login.intro.before")}
        <a href="https://openrouter.ai">OpenRouter</a>
        {t("login.intro.after")}
      </p>
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
    </div>
  );
}

export function App() {
  const [key, setKey] = useState(getKey);
  const [error, setError] = useState<string | null>(null);

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
    <Login error={error} />
  );
}
