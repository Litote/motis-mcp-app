// Dev host of the views (dev.html, dev server only): tool calls made by hand, without model.
import { createRoot } from "react-dom/client";
import { DevHost } from "./DevHost";
import "./styles.css";

// No StrictMode: its double effects would set up each view twice (one AppBridge per tool call)
createRoot(document.getElementById("root")!).render(<DevHost />);
