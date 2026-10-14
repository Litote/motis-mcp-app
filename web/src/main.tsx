import { createRoot } from "react-dom/client";
import { App } from "./App";
import { language } from "./i18n";
import "./styles.css";

document.documentElement.lang = language();

// No StrictMode: its double effects would set up each view twice (one AppBridge per tool call)
createRoot(document.getElementById("root")!).render(<App />);
