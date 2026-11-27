# Demo

[Demo site](https://errance.litote.org/) is a static web chat using the server, for users without an MCP Apps client: the user brings their own
[OpenRouter](https://openrouter.ai) account (free models are available, 50 requests per day
without credits), and everything runs in the browser.

- **Agent loop in the browser**: the model (OpenRouter, streamed) calls the tools of the MCP server (Streamable HTTP,
  directly from the browser), until it answers. Chat UI: [assistant-ui](https://www.assistant-ui.com).
- **Views**: rendered with the ext-apps `AppBridge` in a double-iframe sandbox served from **another origin** than the
  chat, so that a view cannot reach the chat (and the key). The CSP of the sandbox is built per view from its
  `_meta.ui.csp` (`web/sandbox-csp.cjs`, shared by the Vite dev server and the CloudFront Function).
- **Key**: kept in `sessionStorage`, only sent to openrouter.ai; the chat has a strict CSP (scripts of the app only).
- **Models**: the free models able to call tools, and the recent models of the major providers ("All models" lists the
  others). Default: the best free model of the evaluation ([web/eval](web/eval/README.md)) still free on OpenRouter,
  chosen from its scores (`web/src/model-scores.json`); free models fall back on the next ones when their provider is
  rate limited.
- **Loading**: the login screen loads React only; the chat (assistant-ui, markdown, MCP client) is loaded once logged
  in, the AppBridge with the first view.
- **Fullscreen**: requested by a view (⤢), left with Close or Escape (handled by the views as well, the keyboard focus
  being in their frame).
```bash
# MCP server on http://localhost:3001/mcp (stateless HTTP mode, localhost)
MOTIS_APP_CONTACT=you@example.org server/build/install/server/bin/server --http --port 3001
cd web && npm ci && npm run dev   # http://localhost:5173 (the sandbox is served on http://127.0.0.1:5173)
npm test
```

To test the views without a model (no OpenRouter key), open http://localhost:5173/dev.html (dev server only): pick a
tool, type its arguments in JSON and call it; its view is rendered as in the chat, the view's own tool calls go to the
server.

Deployment: Docker image (nginx), see [Self-hosting](docs/SELF-HOSTING.md#web-chat-image), or S3 + CloudFront, see
[AWS deployment](docs/AWS-DEPLOYMENT.md#web-chat).