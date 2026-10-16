# MCP server reference

Reference of the motis-mcp-app MCP server: tools, installation, configuration and MCP clients.
See the [README](../README.md) for an overview, the AWS Lambda deployment, the web chat and the development.

## Tools

| Tool             | MOTIS API                | View                                                                   | Example prompt                                              |
|------------------|--------------------------|------------------------------------------------------------------------|-------------------------------------------------------------|
| `search_places`  | geocode, reverse-geocode | —                                                                      | "What is the stop id of Lyon Part-Dieu?"                    |
| `server_info`    | health, map/initial      | —                                                                      | "Which timetable data does the server use?"                 |
| `explore_area`   | map/stops, map/routes    | map of the stops and lines of an area                                  | "Which lines run around Place Bellecour in Lyon?"           |
| `route_details`  | map/route-details        | map of a line and its stops                                            | "Show me the route of tram T1 in Lyon"                      |
| `reachability`   | one-to-all               | isochrone map                                                          | "Where can I go in 30 minutes by transit from Lyon Part-Dieu?" |
| `departures`     | stoptimes                | departure/arrival board (real time), by line tab in railway stations  | "Next departures at Lyon Part-Dieu"                         |
| `trip_details`   | trip                     | trip timeline                                                          | "Which stops does the next TGV from Lyon Part-Dieu to Paris serve?" |
| `plan_journey`   | plan                     | itineraries list and map                                               | "How to go from Paris Gare de Lyon to Versailles?"          |
| `rentals`        | map/rentals              | shared bikes, scooters and cars map                                    | "Shared bikes near Châtelet, Paris"                         |

`plan_journey` walks up to 25 minutes to the first stop and from the last stop (`maxWalkMinutes`, MOTIS default:
15 minutes). Transfers on foot come from the timetable, not routed on the streets (`useRoutedTransfers=false`): the
server caps the routed ones (about 15 minutes), which drops walks between nearby stations such as Paris Gare de Lyon
and Austerlitz. Its options, set by the model
from the request or in the **Options** panel of the itineraries view:

| Argument          | Values                              | MOTIS                                                           |
|-------------------|-------------------------------------|-----------------------------------------------------------------|
| `time`, `arriveBy`| date-time, leave at / arrive by     | `time`, `arriveBy`                                              |
| `modes`           | transit modes (panel: train, metro, tram, bus, ferry, other) | `transitModes`                         |
| `maxTransfers`    | 0–10                                | `maxTransfers`                                                  |
| `maxWalkMinutes`  | 1–60 (default 25)                   | `maxPreTransitTime`, `maxPostTransitTime`                       |
| `walkingSpeed`    | `SLOW` (0.8 m/s), `NORMAL`, `FAST` (1.6 m/s) | `pedestrianSpeed`                                      |
| `wheelchair`      | boolean                             | `pedestrianProfile=WHEELCHAIR`                                  |
| `transferMargin`  | `NORMAL`, `COMFORTABLE` (+5 min per transfer) | `additionalTransferTime`                              |
| `bike`            | `NONE`, `TO_STATION`, `ON_BOARD`    | `preTransitModes`, `postTransitModes`, `directModes`, `requireBikeTransport` |

With a bike, the ends ridden by bike are sent as coordinates (MOTIS only rides from/to coordinates). `ON_BOARD` only
uses trips allowing bikes: feeds without this information (e.g. Île-de-France) give no itinerary. When the options are
changed in the view, the view tells the model what it shows (`ui/update-model-context`).

Places can be given by name (geocoded, best match), stop id (checked with `stoptimes`, as the geocoder does not search
ids) or `lat,lon`. A name is an error listing the candidates when another place, more than 10 km away, matches almost
as well (e.g. "Saint-Michel"): the model retries with an id or coordinates. The area (city) of a place asked by name is
given with the ends of the journey (`area`), and shown when the name does not tell it: "Saint Michel (Bordeaux)".
`plan_journey` takes the current position of the user (`position`, `lat,lon`): origin when `from` is missing, else
favors the origins near it; the destination is searched near the origin. The views call the tools themselves for
navigation: departures of a stop clicked on the map, line details, trip of a departure, earlier/later pages.

Data volume is bounded before being sent to the views: route variants are grouped by line, route shapes are clipped to
the explored area, and the number of stops, vehicles and reachable places is capped (rental stations and vehicles:
the closest to the center of the area). Rental "stations" holding more than 200 vehicles are area-wide virtual stations
of free-floating operators (all their vehicles of a city at one point): they are reported per provider, not shown as
stations.

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
`MOTIS_APP_CONTACT` (e-mail address or website URL) is mandatory with Transitous. With another MOTIS server
(`MOTIS_BASE_URL`), it is optional: the website of the project is sent instead.

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
| `MOTIS_APP_CONTACT`      | —                                                | required with Transitous                     |
| `MOTIS_BASE_URL`         | `https://api.transitous.org/`                    | any MOTIS 2 server                           |
| `MOTIS_LOG_LEVEL`        | `NONE`                                           | Ktor client logs (`INFO`, `HEADERS`, `ALL`…) |
| `MOTIS_TILE_URL`         | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | raster tiles of the maps                     |
| `MOTIS_TILE_ATTRIBUTION` | OpenStreetMap contributors                       | attribution of the tiles (HTML)              |
| `MOTIS_VIEW_DOMAIN_<HOST>` | default sandbox origin of the host             | dedicated origin of the views (see below)    |
| `MCP_ALLOWED_HOSTS`      | localhost only                                   | host names accepted in HTTP mode             |

The default OpenStreetMap tiles are subject to the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/):
for an intensive use, configure another tile provider. The tile origin is declared in the CSP of the views.

The views run in a sandbox iframe of the host, on an origin of the host (e.g. `web-sandbox.oaiusercontent.com`), shared
by every app by default: a tile provider cannot tell your requests from the others' (`Referer`). The views can request a
dedicated origin (`_meta.ui.domain`), to allowlist at the tile provider. Its format is defined by each host, so each
host has its endpoint (HTTP mode), with its own value:

| Endpoint       | Host                   | `_meta.ui.domain`                                                                  |
|----------------|------------------------|------------------------------------------------------------------------------------|
| `/mcp`         | any                    | none: default sandbox origin of the host                                           |
| `/mcp/chatgpt` | ChatGPT                | `MOTIS_VIEW_DOMAIN_CHATGPT`: an origin unique to the app, e.g. `https://motis.example.org`, served as a subdomain of `oaiusercontent.com` (required to publish an app with views) |
| `/mcp/claude`  | Claude                 | `MOTIS_VIEW_DOMAIN_CLAUDE`, default `<hash>.claudemcpcontent.com`: first 32 hexadecimal characters of the SHA-256 of the endpoint URL, as registered in Claude (`https://…/mcp/claude`) |
| `/mcp/mistral` | Mistral (Le Chat)      | `MOTIS_VIEW_DOMAIN_MISTRAL`, none by default                                       |
| `/mcp/cherry`  | Cherry Studio          | `MOTIS_VIEW_DOMAIN_CHERRY`, none by default                                        |

The tools and views are the same on every endpoint. The Claude default is computed from the URL of the request: set
`MOTIS_VIEW_DOMAIN_CLAUDE` when the public URL differs (reverse proxy).

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

### ChatGPT

ChatGPT connects to a remote HTTPS endpoint only, e.g. the Lambda function URL of the
[AWS deployment](AWS-DEPLOYMENT.md) (`https://<id>.lambda-url.<region>.on.aws/mcp/chatgpt`); the views are rendered
(MCP Apps).

1. In ChatGPT (web), **Plugins** → **+** → **Add a custom MCP server** (developer mode: depending on the plan, enable it
   first in the settings).
2. URL of the endpoint, authentication **None**.
3. In a new conversation, enable the plugin (`+` of the composer, or `@<name>`).

After a deployment changing the tools or the views, select **Refresh** on the plugin and start a new conversation. The
plugin is private to the account: a publication in the ChatGPT directory requires a review by OpenAI.

### Testing the views

The [basic-host](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-host) of the ext-apps
repository renders the views of a server running in HTTP mode on `http://localhost:3001/mcp`.
[MCP Inspector](https://github.com/modelcontextprotocol/inspector) shows the raw tools and resources.
