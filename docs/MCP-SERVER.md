# MCP server reference

Reference of the motis-mcp-app MCP server: tools, installation, configuration and MCP clients.
See the [README](../README.md) for an overview, the AWS Lambda deployment, the web chat and the development.

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

`plan_journey` walks up to 25 minutes to the first stop and from the last stop (`maxWalkMinutes`, MOTIS default:
15 minutes), and routes the transfers on foot on the streets (`useRoutedTransfers`).

Places can be given by name (geocoded, best match), stop id or `lat,lon`. The views call the tools themselves for
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
