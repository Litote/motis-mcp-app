# Changelog

## 0.1.0 (2026-11-27)

First release of Errance: an [MCP server](https://modelcontextprotocol.io) and [MCP App](https://modelcontextprotocol.io/extensions/apps/overview) to explore the public transport data of a [MOTIS](https://github.com/motis-project/motis) server, by default [Transitous](https://transitous.org/), which aggregates open GTFS, GTFS-RT and GBFS feeds worldwide.

### Tools and views

Each tool with a view renders it in the hosts that support MCP Apps; the other hosts get the text.

* **Journeys** (`plan_journey`): the connections, their legs on the map in the colors of their lines, the detailed itinerary, earlier and later connections, and options (modes, transfers, walking, wheelchair, bike). Journeys between cities go from station to station.
* **Departure boards** (`departures`): departures and arrivals in real time (delays, cancellations, tracks), a tab per line or mode in railway stations, and the trains in the style of the boards of their operator (SNCF, SNCB, SBB, DB, NS, RFI, ADIF, National Rail).
* **Trips** (`trip_details`): the stops of a vehicle, their times and tracks, and its current position.
* **Area** (`explore_area`) and **lines** (`route_details`): the stops and lines around a place, the path of a line.
* **Isochrones** (`reachability`): the stops reachable within a travel time.
* **Shared mobility** (`rentals`): stations and free-floating bikes, scooters and cars, by provider.
* `search_places` and `server_info`, without a view.

### Data

* The SNCF real time, tracks and service alerts added to the trains without them in MOTIS, TER of the regional feeds included, and the real time of the Trenitalia trains in France.
* The service alerts of the lines, stops and trains on the boards, trips and journeys.
* The railway stations under the same name whatever the feed, in the language of the user, and the ambiguous cities resolved by asking which one is meant.

### Views

* Maps drawn from Protomaps vector tiles, with the railways over them (IGN in France, OpenRailwayMap elsewhere).
* 20 languages, the language and the colors (light and dark themes) of the host, a fullscreen layout for each view, and a refresh button.

### Hosted instance and web chat

* The server hosted at `https://errance.litote.org/mcp` (Streamable HTTP, no account), with a rate limit of the tool calls per client.
* A static web chat at [errance.litote.org](https://errance.litote.org/): users bring their own OpenRouter account, the free model is chosen from a daily evaluation, and the conversation can be exported to describe a bug. Privacy policy and terms of use on the domain.

### Distribution

* Docker images `ghcr.io/litote/motis-mcp-app` (server) and `ghcr.io/litote/motis-mcp-app-web` (web chat), for `linux/amd64` and `linux/arm64`, with provenance and SBOM.
* Two entries in the [MCP registry](https://registry.modelcontextprotocol.io): `org.litote/motis-mcp-app` (the server, any MOTIS server) and `org.litote/errance` (the hosted instance).
* Self-hosting with Docker Compose, and the AWS deployment with Terraform: GraalVM native executable on Lambda behind CloudFront, stopped when the monthly budget is exceeded.

The full list of the changes: [the commits of 0.1.0](https://github.com/Litote/motis-mcp-app/commits/v0.1.0).
