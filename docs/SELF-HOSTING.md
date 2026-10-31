# Self-hosting

The MCP server and the web chat on a local machine or any Docker host, without AWS.
See the [README](../README.md) for an overview, the [MCP server reference](MCP-SERVER.md) for the configuration of the
server and [AWS deployment](AWS-DEPLOYMENT.md) for the Lambda + CloudFront deployment.

## Docker Compose

`compose.yaml` runs two services, bound to `127.0.0.1`:

| Service | Image                              | URL                                                         |
|---------|------------------------------------|-------------------------------------------------------------|
| `mcp`   | `ghcr.io/litote/motis-mcp-app`     | `http://localhost:3001/mcp` (Streamable HTTP, stateless)    |
| `web`   | `ghcr.io/litote/motis-mcp-app-web` | `http://localhost:8080` (chat), `http://localhost:8081` (view sandbox) |

```bash
cp .env.sample .env              # set MOTIS_APP_CONTACT (Transitous)
docker compose up -d             # published images (MOTIS_MCP_APP_VERSION: tag, default latest)
docker compose up -d --build     # images built from the sources
docker compose logs -f
```

Then open `http://localhost:8080`: the chat uses the MCP server of the stack. The same server is available to the other
MCP clients:

```bash
claude mcp add --transport http motis http://localhost:3001/mcp
```

### Configuration

The variables are read from `.env` (see `.env.sample`):

| Variable                                                         | Default                     |                                              |
|------------------------------------------------------------------|-----------------------------|----------------------------------------------|
| `MOTIS_APP_CONTACT`                                              | —                           | required with Transitous (usage policy)      |
| `MOTIS_MCP_APP_VERSION`                                          | `latest`                    | tag of the two images                        |
| `MOTIS_BASE_URL`, `MOTIS_LOG_LEVEL`, `MOTIS_TILE_URL`, `MOTIS_TILE_ATTRIBUTION`, `MOTIS_VIEW_DOMAIN_<HOST>`, `MCP_ALLOWED_HOSTS`, `MOTIS_SNCF_REALTIME` | see [MCP server reference](MCP-SERVER.md#usage) | MCP server |
| `MCP_URL`                                                        | `http://localhost:3001/mcp` | MCP endpoint, as seen by the browser         |
| `APP_ORIGIN`                                                     | `http://localhost:8080`     | origin of the chat, as seen by the browser   |
| `SANDBOX_ORIGIN`                                                 | `http://localhost:8081`     | origin of the view sandbox                   |

### Your own MOTIS server

The server works with any [MOTIS 2](https://github.com/motis-project/motis) server: set `MOTIS_BASE_URL` (e.g.
`http://motis:8080/` for a `motis` service added to the stack, or `http://host.docker.internal:8080/`).
`MOTIS_APP_CONTACT` is then optional.

MOTIS only serves the data it has imported: an OpenStreetMap extract (street routing, geocoding), GTFS feeds
(timetables), and optionally GTFS-RT (real time) and GBFS (rentals) URLs. GTFS feeds expire: they have to be downloaded
and imported again regularly. See the [MOTIS documentation](https://github.com/motis-project/motis) for the import and
the configuration, and the [feeds of Transitous](https://github.com/public-transport/transitous) for the sources of a
region.

Worth it for data missing from Transitous (a feed not yet published), an intensive or public use, or a stack without
internet access (the map tiles stay external, see `MOTIS_TILE_URL`); otherwise Transitous covers more, kept up to date.

## Web chat image

`web/Dockerfile` builds the chat and serves it with nginx, as CloudFront does in production (`infra/web.tf`):

- **two origins**: the chat on port 8080, `sandbox.html` (outer frame of the MCP App views) on port 8081. A different
  port is a different origin: a view cannot reach the chat and the OpenRouter key.
- **CSP of the chat**: scripts of the app only, `connect-src` limited to openrouter.ai and `MCP_URL`, frames limited to
  `SANDBOX_ORIGIN`.
- **CSP of the sandbox**: built per view from the `csp` query parameter by [njs](https://nginx.org/en/docs/njs/), with
  `web/sandbox-csp.cjs`, the code of the CloudFront Function and of the Vite dev server (`web/nginx/sandbox-csp.njs.js`
  is appended to it when the image is built).
- **`config.json`**: rendered from `MCP_URL`, `APP_ORIGIN` and `SANDBOX_ORIGIN` when the container starts (templates of
  the official nginx image, `web/nginx/templates`).

```bash
docker build -t motis-mcp-app-web web
docker run --rm -p 127.0.0.1:8080:8080 -p 127.0.0.1:8081:8081 -e MCP_URL=http://localhost:3001/mcp motis-mcp-app-web
web/nginx/smoke-test.sh motis-mcp-app-web   # headers, config.json and sandbox CSP (run by the CI)
```

## Without Docker

Requirements: see [From source](MCP-SERVER.md#from-source).

```bash
./gradlew :server:installDist
MOTIS_APP_CONTACT=you@example.org server/build/install/server/bin/server --http --port 3001

cd web && npm ci
npm run dev                       # development server: http://localhost:5173
npm run build && npm run preview  # production build, same URL
```

The dev and preview servers serve the sandbox on `http://127.0.0.1:5173` (another origin than `localhost:5173`), with
the CSP built by `web/sandbox-csp.cjs`.

## Exposing the stack

`compose.yaml` only listens on `127.0.0.1`. To reach the stack from other machines, put a reverse proxy with TLS in
front of it, with one host name per service:

- **HTTPS**: outside `localhost`, the browser only allows `crypto.subtle` (OpenRouter login with PKCE) in a secure
  context.
- **Distinct origins**: the chat and the sandbox need two host names (e.g. `chat.example.org`,
  `sandbox.example.org`); set `APP_ORIGIN`, `SANDBOX_ORIGIN` and `MCP_URL` to the public URLs.
- **`MCP_ALLOWED_HOSTS`**: the host name of the MCP endpoint (DNS rebinding protection of the server).
- **Load**: the MCP endpoint has no authentication and accepts any origin (CORS): limit the request rate in the reverse
  proxy, and configure a tile provider (`MOTIS_TILE_URL`) for a public use.

claude.ai custom connectors need a public HTTPS MCP endpoint: a stack on `localhost` is only reachable by local clients
(Claude Code, MCP Inspector, the web chat).
