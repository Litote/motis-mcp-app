# <img src="web/public/logo.svg" alt="" width="36" height="36"> Errance: MCP server and MCP App to explore public transport

[![CI](https://github.com/Litote/motis-mcp-app/actions/workflows/ci.yml/badge.svg)](https://github.com/Litote/motis-mcp-app/actions/workflows/ci.yml)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=Litote_motis-mcp-app&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=Litote_motis-mcp-app)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=Litote_motis-mcp-app&metric=coverage)](https://sonarcloud.io/summary/new_code?id=Litote_motis-mcp-app)

[MCP server](https://modelcontextprotocol.io) and [MCP App](https://modelcontextprotocol.io/extensions/apps/overview)
to explore the public transport data of a [MOTIS](https://github.com/motis-project/motis) server: by default
[Transitous](https://transitous.org/), which aggregates open GTFS, GTFS-RT and GBFS feeds worldwide. Journeys,
departure boards and maps are shown in interactive views in the hosts that support MCP Apps; the other hosts get the
text.

## Quick start

### Local server (Docker)

```bash
# any MCP client, with add-mcp
npx add-mcp "docker run -i --rm -e MOTIS_APP_CONTACT=you@example.org ghcr.io/litote/motis-mcp-app" --name errance

# Claude Code
claude mcp add errance -- docker run -i --rm -e MOTIS_APP_CONTACT=you@example.org ghcr.io/litote/motis-mcp-app
```

`MOTIS_APP_CONTACT` (e-mail address) is required by the [Transitous usage policy](https://transitous.org/api/).


### Hosted server

The server runs at `https://errance.litote.org/mcp` (Streamable HTTP, no account needed).

- **Any MCP client** (Claude Code, Cursor, VS Code, Codex, Gemini CLI…), with [add-mcp](https://add-mcp.com):

  ```bash
  npx add-mcp https://errance.litote.org/mcp --name errance
  ```

- **Claude Code**:

  ```bash
  claude mcp add --transport http errance https://errance.litote.org/mcp
  ```

## Demo

The [demo site](https://errance.litote.org/) is a static web chat. Users bring their own [OpenRouter](https://openrouter.ai) account (free models are available, 50 requests a day
without credits), and everything runs in the browser.

<p align="center">
  <img src="web/public/home-journey.png" width="500"
       alt="plan_journey view: a Paris to Frankfurt journey, with the list of connections, the map and the detailed itinerary">
</p>

More in the [demo FAQ](DEMO.md).

## Documentation

[MCP server reference](docs/MCP-SERVER.md): the tools, the configuration and the setup of the MCP clients

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md): structure of the project, tests, quality, commit conventions and release.

## License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE).
