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

[MCP App](https://github.com/modelcontextprotocol/ext-apps) to explore the public transport data of a
[MOTIS](https://github.com/motis-project/motis) server — by default [Transitous](https://transitous.org/), which
aggregates open GTFS, GTFS-RT and GBFS feeds worldwide.

The MCP server is written in Kotlin with the [MCP Kotlin SDK](https://github.com/modelcontextprotocol/kotlin-sdk) and
calls MOTIS with [motis-ktor-client](https://github.com/Litote/motis-ktor-client). Its tools return a text summary for
the model and structured data rendered by interactive views (maps, departure boards) in hosts supporting MCP Apps
(Claude, ChatGPT, …). Hosts without MCP Apps support still get the text.

## Tools

| Tool             | MOTIS API                            | View                                   |
|------------------|--------------------------------------|----------------------------------------|
| `search_places`  | geocode, reverse-geocode             | —                                      |
| `server_info`    | health, map/initial                  | —                                      |
| `explore_area`   | map/stops, map/routes                | map of the stops and lines of an area  |
| `route_details`  | map/route-details                    | map of a line and its stops            |
| `reachability`   | one-to-all                           | isochrone map                          |
| `departures`     | stoptimes                            | departure/arrival board (real time)    |
| `trip_details`   | trip                                 | trip timeline                          |
| `plan_journey`   | plan                                 | itineraries list and map               |
| `rentals`        | map/rentals                          | shared bikes, scooters and cars map    |

Places can be given by name (geocoded, best match), stop id or `lat,lon`. The views call the tools themselves for
navigation: departures of a stop clicked on the map, line details, trip of a departure, earlier/later pages.

## Installation

### Docker

Each release publishes a multi-architecture image (`linux/amd64`, `linux/arm64`) on the GitHub Container Registry:

```bash
docker pull ghcr.io/litote/motis-mcp-app:latest   # or a version: ghcr.io/litote/motis-mcp-app:<version>
```

Requirements: Docker only (the image includes the Java runtime).

### From source

Requirements: JDK 25, Node.js 26+ (npm on the `PATH`, or `-Pnpm=/path/to/npm`).

```bash
./gradlew :server:installDist    # bundles the views (ui/) and builds server/build/install/server
./gradlew :server:shadowJar      # single jar: server/build/libs/server-main-SNAPSHOT-all.jar
```

## Usage

The [Transitous usage policy](https://transitous.org/api/) requires a way of contact in the `User-Agent`:
`MOTIS_APP_CONTACT` (e-mail address or website URL) is mandatory.

```bash
# stdio (Claude Desktop, Claude Code…)
docker run -i --rm -e MOTIS_APP_CONTACT=you@example.org ghcr.io/litote/motis-mcp-app

# Streamable HTTP, endpoint http://127.0.0.1:3001/mcp
docker run --rm -p 127.0.0.1:3001:3001 -e MOTIS_APP_CONTACT=you@example.org ghcr.io/litote/motis-mcp-app \
  --http --host 0.0.0.0
```

From source, the same options apply to `server/build/install/server/bin/server`:

```bash
MOTIS_APP_CONTACT=you@example.org server/build/install/server/bin/server --stdio

# Streamable HTTP, endpoint http://127.0.0.1:3001/mcp
MOTIS_APP_CONTACT=you@example.org server/build/install/server/bin/server --http --port 3001
```

| Variable                 | Default                                          |                                              |
|--------------------------|--------------------------------------------------|----------------------------------------------|
| `MOTIS_APP_CONTACT`      | —                                                | required                                     |
| `MOTIS_BASE_URL`         | `https://api.transitous.org/`                    | any MOTIS 2 server                           |
| `MOTIS_LOG_LEVEL`        | `NONE`                                           | Ktor client logs (`INFO`, `HEADERS`, `ALL`…) |
| `MOTIS_TILE_URL`         | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | raster tiles of the maps                     |
| `MOTIS_TILE_ATTRIBUTION` | OpenStreetMap contributors                       | attribution of the tiles (HTML)              |
| `MCP_ALLOWED_HOSTS`      | localhost only                                   | host names accepted in HTTP mode             |

The default OpenStreetMap tiles are subject to the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/):
for an intensive use, configure another tile provider. The tile origin is declared in the CSP of the views.

Environment variables are passed to the container with `-e`.

### Claude Code

```bash
claude mcp add motis -- docker run -i --rm -e MOTIS_APP_CONTACT=you@example.org ghcr.io/litote/motis-mcp-app
```

### Claude Desktop

```json
{
  "mcpServers": {
    "motis": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "MOTIS_APP_CONTACT=you@example.org", "ghcr.io/litote/motis-mcp-app"]
    }
  }
}
```

### Testing the views

The [basic-host](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-host) of the ext-apps
repository renders the views of a server running in HTTP mode on `http://localhost:3001/mcp`.
[MCP Inspector](https://github.com/modelcontextprotocol/inspector) shows the raw tools and resources.

## Deploy on AWS Lambda

`lambda/` packages the server as a GraalVM native executable for the `provided.al2023` runtime, exposed by a public
Lambda function URL (`https://<id>.lambda-url.<region>.on.aws/mcp`). `infra/` holds the Terraform and a Makefile.

Requirements: Docker (the GraalVM build runs in `ghcr.io/graalvm/native-image-community:25`), Terraform,
AWS credentials.

```bash
cd infra
make bootstrap                                 # once per AWS account: state bucket + GitHub Actions deploy and plan roles
cp backend.hcl.sample backend.hcl              # set the state bucket printed by bootstrap
cp terraform.tfvars.sample terraform.tfvars    # set motis_app_contact
make init
make deploy        # make build (native zip: lambda/build/libs/lambda.zip) + terraform apply
make logs
```

`bootstrap/` keeps a local state (gitignored): keep `infra/bootstrap/terraform.tfstate`. It reuses the GitHub OIDC
identity provider of the account; on an account without one, run it with `-var create_github_oidc_provider=true`.

### Architecture

The Lambda runs on **arm64** (Graviton, cheaper than x86_64) by default, Terraform variable `architecture`.
`native-image` compiles for the platform it runs on, so the zip must be built on the same architecture:

- **CI** builds on an arm64 runner (`ubuntu-24.04-arm`), and checks that `bootstrap` is `aarch64`.
- **`make`** builds for the **host** architecture (`LAMBDA_ARCH`, from `uname -m`) and passes the same value to
  Terraform: from an x86_64 host the function runs on x86_64 until the next CI deploy. `LAMBDA_ARCH=arm64` on an
  x86_64 host builds under QEMU emulation, which takes hours.

### Continuous deployment

`.github/workflows/deploy-lambda.yml` (paths `server/`, `lambda/`, `ui/`, `web/`, `infra/`, Gradle files):

| Event            | Jobs                                                                                    |
|------------------|-----------------------------------------------------------------------------------------|
| pull request     | build (tests, native arm64 zip, smoke test in the Lambda runtime emulator), web chat build → `terraform plan` (read-only role) |
| push to `main`   | build → `terraform apply` (deploys the zip) → smoke test of the deployed endpoint → web chat upload |
| manual           | same as a push                                                                          |

The AWS jobs (`terraform plan`, `terraform apply`, web chat upload) are skipped while the `AWS_REGION` variable is not
set: the builds and their smoke tests still run.

GitHub configuration:

| Kind                         | Name                                            | Value                                                |
|------------------------------|-------------------------------------------------|------------------------------------------------------|
| secret                       | `AWS_ROLE_ARN`                                  | `deploy_role_arn` output of `make bootstrap`         |
| secret                       | `AWS_PLAN_ROLE_ARN`                             | `plan_role_arn` output of `make bootstrap` (read-only, pull requests) |
| secret (optional)            | `GRADLE_ENCRYPTION_KEY`                         | Gradle configuration cache encryption key            |
| secret (optional)            | `SONAR_TOKEN`                                   | SonarCloud analysis of `ci.yml`                      |
| secret                       | `RELEASE_PLEASE_APP_ID`, `RELEASE_PLEASE_APP_PRIVATE_KEY` | GitHub App of `release-please.yml`      |
| variable                     | `AWS_REGION`                                    | e.g. `eu-west-3`                                     |
| variable                     | `TF_STATE_BUCKET`                               | `state_bucket` output of `make bootstrap`            |
| variable                     | `MOTIS_APP_CONTACT`                             | contact sent in the User-Agent (Transitous policy)   |
| variable (optional)          | `MOTIS_TILE_URL`, `MOTIS_TILE_ATTRIBUTION`      | tile provider                                        |
| environment                  | `production`                                    | deployment branch policy: `main` only                |

The endpoint uses the **stateless** Streamable HTTP mode: successive requests of a client may reach different Lambda
instances, so no session is kept and every request is answered in JSON (no SSE stream, `GET` returns 405). The DNS
rebinding protection is disabled (public endpoint) and CORS is handled by the function URL.

The native image needs reflection/resources metadata, recorded by replaying MCP requests against MOTIS under the
native-image agent: run `make trace` after changing the tools or upgrading the dependencies, and commit
`lambda/src/main/resources/META-INF/native-image`.

The endpoint has no authentication: bound the load on MOTIS and the cost with `reserved_concurrency`, and configure a
tile provider (`tile_url`) for a public use.

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

Deployment (`infra/web.tf`): an S3 bucket and two CloudFront distributions (chat, sandbox); `config.json` (MCP
endpoint, sandbox URL, allowed origins) is written by Terraform. `make web` (part of `make deploy`) builds and uploads the
files; CI does the same after `terraform apply`. Terraform output `web_url`.

## Development

### Structure

```
server/   Kotlin MCP server
  MotisGateway        MOTIS clients, place resolution, error mapping
  tools/              tool definitions (schemas, summaries)
  dto/                compact structured content for the views, polyline clipping
  apps/AppResources   ui:// resources (text/html;profile=mcp-app), CSP, tool _meta.ui
ui/       views (TypeScript, Vite, Leaflet), each bundled in a single HTML file
lambda/   AWS Lambda entry point (GraalVM native): function URL events run through a Ktor engine without socket
infra/    Terraform (Lambda, function URL, web chat on S3 + CloudFront) and Makefile (native build in Docker, deploy)
web/      web chat (OpenRouter, assistant-ui): agent loop in the browser, views in a sandbox
```

Data volume is bounded before being sent to the views: route variants are grouped by line, route shapes are clipped to
the explored area, and the number of stops, vehicles and reachable places is capped (rental stations and vehicles:
the closest to the center of the area). Rental "stations" holding more than 200 vehicles are area-wide virtual stations
of free-floating operators (all their vehicles of a city at one point): they are reported per provider, not shown as
stations.

### Quality

The CI (`ci.yml`) analyses the project with [SonarCloud](https://sonarcloud.io/summary/new_code?id=Litote_motis-mcp-app)
(`SONAR_TOKEN` secret): the Kotlin modules with their JaCoCo coverage, the views (`ui/`), the web chat (`web/`) and the
Terraform (`infra/`). To run the analysis locally, set `systemProp.sonar.token=<token>` in `~/.gradle/gradle.properties`:

```bash
./gradlew check jacocoAggregatedReport sonar sonarCheck
```

`sonarCheck` fails if the quality gate is not OK, or if any issue or security hotspot remains.

The GitHub workflows are audited by [zizmor](https://docs.zizmor.sh) (`zizmor.yml`), and the dependencies (Gradle, npm,
GitHub Actions, Terraform providers) are updated by Dependabot.

### Tests

No test needs network access:

- `server/`: the MCP tools against a mocked MOTIS API (Ktor `MockEngine`), with answers recorded from Transitous
  (`server/src/test/resources/motis`);
- `ui/` (vitest, jsdom): the views, loaded with a fake MCP Apps host, rendering results of the server
  (`ui/src/test/*.json`);
- `web/` (vitest, jsdom and Testing Library): the agent loop, the OpenRouter and MCP clients, the sandbox and the React
  components.

```bash
./gradlew check jacocoAggregatedReport   # server and lambda tests, coverage
cd ui && npm run coverage                # views tests (npm test: without coverage)
cd web && npm run coverage               # web chat tests
```

The pull requests also build the native Lambda and run it in the Lambda runtime emulator (`deploy-lambda.yml`).

### Release

Releases are managed by [release-please](https://github.com/googleapis/release-please) from
[Conventional Commits](https://www.conventionalcommits.org/) (see [CONTRIBUTING.md](CONTRIBUTING.md)):
each push on `main` updates a release PR, and merging it creates the tag and the GitHub release, and publishes the
Docker image `ghcr.io/litote/motis-mcp-app` (`<version>`, `<major>.<minor>` and `latest` tags).

```bash
# local image
docker build -t motis-mcp-app .
```

The Lambda is deployed independently, on every push on `main` (see [Continuous deployment](#continuous-deployment)).

See [CONTRIBUTING.md](CONTRIBUTING.md) for the commit conventions and the checks to run before opening a pull request.

## License

This project is licensed under the [Apache License 2.0](LICENSE).
