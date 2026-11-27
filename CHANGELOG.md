# Changelog

## [0.1.1](https://github.com/Litote/motis-mcp-app/compare/v0.1.0...v0.1.1) (2026-11-27)


### Bug Fixes

* **infra:** fix custom origins and endpoint - [#188](https://github.com/Litote/motis-mcp-app/issues/188) ([c05fcd7](https://github.com/Litote/motis-mcp-app/commit/c05fcd76f68938c01ac8611d6dd33306e5eda8ba))
* keep the data for the views only out of the model context ([#202](https://github.com/Litote/motis-mcp-app/issues/202)) ([908e818](https://github.com/Litote/motis-mcp-app/commit/908e818e19905d9a83e4637efec8eb35fc21af8a))
* **lambda:** the logo in the native image (serverInfo.icons), and a ChatGPT-sized logo ([#203](https://github.com/Litote/motis-mcp-app/issues/203)) ([87bb560](https://github.com/Litote/motis-mcp-app/commit/87bb560a196f4499f89d6c0f2cc1152e6d3a671e))
* **web:** serve a favicon ([#204](https://github.com/Litote/motis-mcp-app/issues/204)) ([4859061](https://github.com/Litote/motis-mcp-app/commit/4859061dbbf6d3431f60fbe80ae9875ac5b4ffc8))


### Performance Improvements

* **docker:** a Java runtime made with jlink and an AOT cache, the JVM warnings on stderr ([#189](https://github.com/Litote/motis-mcp-app/issues/189)) ([19886a4](https://github.com/Litote/motis-mcp-app/commit/19886a41235003e350c22a7d293635699d10ee50))

## 0.1.0 (2026-11-27)

First release of Errance: an [MCP server](https://modelcontextprotocol.io) and [MCP App](https://modelcontextprotocol.io/extensions/apps/overview) to explore the public transport data of a [MOTIS](https://github.com/motis-project/motis) server, by default [Transitous](https://transitous.org/), which aggregates open GTFS, GTFS-RT and GBFS feeds worldwide.

### Tools and views

Each tool with a view renders it in the hosts that support MCP Apps; the other hosts get the text.

* **Journeys** (`plan_journey`): the connections, their legs on the map in the colors of their lines, the detailed itinerary, earlier and later connections, and options (modes, transfers, walking, wheelchair, bike). Journeys between cities go from station to station, and an ambiguous city (Brest) is asked about.
* **Departure boards** (`departures`): departures and arrivals in real time (delays, cancellations, tracks), a tab per line or mode in railway stations, and the trains in the style of the boards of their operator (SNCF, SNCB, SBB, DB, NS, RFI, ADIF, National Rail).
* **Trips** (`trip_details`): the stops of a vehicle, their times and tracks, and its current position.
* **Area** (`explore_area`) and **lines** (`route_details`): the stops and lines around a place, the path of a line.
* **Isochrones** (`reachability`): the stops reachable within a travel time.
* **Shared mobility** (`rentals`): stations and free-floating bikes, scooters and cars, by provider.
* `search_places` and `server_info`, without a view.

### Data

The data come from the MOTIS server (Transitous by default). A few targeted complements fill its gaps, only where it has nothing:

* **SNCF real time**: the times, cancellations and tracks of the SNCF trains (TGV, Intercités, TER, those of the regional feeds included) without real time in Transitous, from the open data of the SNCF on [transport.data.gouv.fr](https://transport.data.gouv.fr/datasets/horaires-sncf) (GTFS-RT trip updates, SIRI Lite estimated timetable), matched by train number and scheduled time. Disabled with `MOTIS_SNCF_REALTIME=false`.
* **SNCF service alerts**: Transitous has none for the SNCF trains; they are taken from the SNCF GTFS-RT service alerts of the same source, and shown with the alerts of the feeds on the boards, trips and journeys.
* **Station names**: a railway station under the same name whatever the feed, its city in the language of the user ("Girona" → "Gérone"), from a table generated from the stations of [Trainline](https://github.com/trainline-eu/stations) (ODbL) and the labels of [Wikidata](https://www.wikidata.org/) (CC0).

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
