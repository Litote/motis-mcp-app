import { createRequire } from "node:module";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const { buildSandboxCsp } = createRequire(import.meta.url)("./sandbox-csp.cjs") as {
  buildSandboxCsp: (cspJson: string) => string;
};

/**
 * Dev server: sets the CSP header of sandbox.html from its `csp` query parameter, as the CloudFront Function does in
 * production. The sandbox is opened on http://127.0.0.1:5173 while the app runs on http://localhost:5173: two origins.
 */
function sandboxCsp(): Plugin {
  return {
    name: "sandbox-csp",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname === "/sandbox.html") {
          res.setHeader("Content-Security-Policy", buildSandboxCsp(url.searchParams.get("csp") ?? ""));
          res.setHeader("Cache-Control", "no-store");
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), sandboxCsp()],
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  build: {
    rolldownOptions: {
      input: { index: "index.html", sandbox: "sandbox.html" },
      output: {
        // libraries in their own chunks: cached across deployments of the app code
        codeSplitting: {
          // a group must not pull the modules it depends on (Vite preload helper…), they stay in the shared chunks
          includeDependenciesRecursively: false,
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 40 },
            // AppBridge: loaded with the first view
            { name: "mcp-apps", test: /node_modules[\\/]@modelcontextprotocol[\\/]ext-apps[\\/]/, priority: 35 },
            { name: "mcp", test: /node_modules[\\/](@modelcontextprotocol|zod|pkce-challenge|eventsource)/, priority: 30 },
            {
              name: "markdown",
              test: /node_modules[\\/](react-markdown|remark-|rehype-|micromark|mdast-|hast-|unified|unist-|vfile|property-information|decode-named|character-|ccount|markdown-table|zwitch|trim-lines|longest-streak|html-url-attributes|space-separated|comma-separated|style-to-|inline-style-parser|estree-util|devlop|bail|trough|is-plain-obj|extend|escape-string-regexp)/,
              priority: 20,
            },
            { name: "assistant-ui", test: /node_modules[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
  test: {
    environment: "node",
  },
});
