import { createRoot } from "react-dom/client";
import { App } from "./App";
import { language, loadLanguage } from "./i18n";
import { applyTheme } from "./theme";
import "./styles.css";

document.documentElement.lang = language();
// the theme chosen from the first render
applyTheme();

// the texts in the language of the browser from the first render (a chunk of a few kB, English if it fails)
await loadLanguage();

// No StrictMode: its double effects would set up each view twice (one AppBridge per tool call)
createRoot(document.getElementById("root")!).render(<App />);
