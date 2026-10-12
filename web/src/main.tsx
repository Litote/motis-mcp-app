import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// No StrictMode: its double effects would set up each view twice (one AppBridge per tool call)
createRoot(document.getElementById("root")!).render(<App />);
