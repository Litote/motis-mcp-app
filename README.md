# motis-mcp-app

[![CI](https://github.com/Litote/motis-mcp-app/actions/workflows/ci.yml/badge.svg)](https://github.com/Litote/motis-mcp-app/actions/workflows/ci.yml)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=Litote_motis-mcp-app&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=Litote_motis-mcp-app)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=Litote_motis-mcp-app&metric=coverage)](https://sonarcloud.io/summary/new_code?id=Litote_motis-mcp-app)
[![Bugs](https://sonarcloud.io/api/project_badges/measure?project=Litote_motis-mcp-app&metric=bugs)](https://sonarcloud.io/summary/new_code?id=Litote_motis-mcp-app)
[![Vulnerabilities](https://sonarcloud.io/api/project_badges/measure?project=Litote_motis-mcp-app&metric=vulnerabilities)](https://sonarcloud.io/summary/new_code?id=Litote_motis-mcp-app)
[![Code Smells](https://sonarcloud.io/api/project_badges/measure?project=Litote_motis-mcp-app&metric=code_smells)](https://sonarcloud.io/summary/new_code?id=Litote_motis-mcp-app)
[![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=Litote_motis-mcp-app&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=Litote_motis-mcp-app)
[![Reliability Rating](https://sonarcloud.io/api/project_badges/measure?project=Litote_motis-mcp-app&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=Litote_motis-mcp-app)
[![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=Litote_motis-mcp-app&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=Litote_motis-mcp-app)

[MCP Server](https://modelcontextprotocol.io) and [MCP App](https://modelcontextprotocol.io/extensions/apps/overview) to explore the public transport data of a
[MOTIS](https://github.com/motis-project/motis) server — by default [Transitous](https://transitous.org/), which
aggregates open GTFS, GTFS-RT and GBFS feeds worldwide.

The MCP server is written in Kotlin with the [MCP Kotlin SDK](https://github.com/modelcontextprotocol/kotlin-sdk) and
calls MOTIS with [motis-ktor-client](https://github.com/Litote/motis-ktor-client). Its tools return a text summary for
the model and structured data rendered by interactive views (maps, departure boards) in hosts supporting MCP Apps
(Claude, ChatGPT, …). Hosts without MCP Apps support still get the text.

See the [MCP server reference](docs/MCP-SERVER.md) for the tools, the installation, the configuration and
the setup of MCP clients (Claude Code, Claude Desktop…).

## Quick start

```bash
claude mcp add motis -- docker run -i --rm -e MOTIS_APP_CONTACT=you@example.org ghcr.io/litote/motis-mcp-app
```

`MOTIS_APP_CONTACT` (e-mail address or website URL) is required by the
[Transitous usage policy](https://transitous.org/api/).

## Deployment

- **Self-hosting**: the MCP server and the web chat on a local machine or any Docker host, with Docker Compose
  (`docker compose up`) or from the sources: see [Self-hosting](docs/SELF-HOSTING.md).
- **AWS**: the MCP server on AWS Lambda (GraalVM native executable, public function URL), and the web chat on
  S3 + CloudFront, with Terraform and GitHub Actions: see [AWS deployment](docs/AWS-DEPLOYMENT.md).

## Web chat (OpenRouter)

`web/` is a static web chat using the server, for users without an MCP Apps client: the user brings their own
[OpenRouter](https://openrouter.ai) account (OAuth login or pasted key; free models are available, 50 requests per day
without credits), and everything runs in the browser.

- **Agent loop in the browser**: the model (OpenRouter, streamed) calls the tools of the MCP server (Streamable HTTP,
  directly from the browser), until it answers. Chat UI: [assistant-ui](https://www.assistant-ui.com).
- **Views**: rendered with the ext-apps `AppBridge` in a double-iframe sandbox served from **another origin** than the
  chat, so that a view cannot reach the chat (and the key). The CSP of the sandbox is built per view from its
  `_meta.ui.csp` (`web/sandbox-csp.cjs`, shared by the Vite dev server and the CloudFront Function).
- **Key**: kept in `sessionStorage`, only sent to openrouter.ai; the chat has a strict CSP (scripts of the app only).
- **Models**: the free models able to call tools, and the recent models of the major providers ("All models" lists the
  others). Default: `nvidia/nemotron-3-super-120b-a12b:free`; free models fall back on other free models when their
  provider is rate limited.
- **Loading**: the login screen loads React only; the chat (assistant-ui, markdown, MCP client) is loaded once logged
  in, the AppBridge with the first view.
- **Fullscreen**: requested by a view (⤢), left with Close or Escape (handled by the views as well, the keyboard focus
  being in their frame).

```bash
# MCP server on http://localhost:3001/mcp (stateful HTTP mode, localhost)
MOTIS_APP_CONTACT=you@example.org server/build/install/server/bin/server --http --port 3001
cd web && npm ci && npm run dev   # http://localhost:5173 (the sandbox is served on http://127.0.0.1:5173)
npm test
```

Deployment: Docker image (nginx), see [Self-hosting](docs/SELF-HOSTING.md#web-chat-image), or S3 + CloudFront, see
[AWS deployment](docs/AWS-DEPLOYMENT.md#web-chat).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md): structure of the project, tests, quality, commit conventions and release.

## License

This project is licensed under the [Apache License 2.0](LICENSE).
