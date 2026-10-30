package org.litote.motis.mcp.tools

import io.modelcontextprotocol.kotlin.sdk.server.Server
import org.litote.motis.client.model.LocationType
import org.litote.motis.mcp.MotisGateway
import org.litote.motis.mcp.dto.Coordinates
import org.litote.motis.mcp.dto.SearchResult
import org.litote.motis.mcp.dto.ServerInfoResult
import org.litote.motis.mcp.dto.toDto

private val LOCATION_TYPES = listOf("STOP", "ADDRESS", "PLACE")

internal const val LANGUAGE_DESCRIPTION = "Preferred language of the names, as ISO 639-1 code (e.g. fr, de)."

fun Server.addPlaceTools(gateway: MotisGateway, baseUrl: String) {
    motisTool(
        name = "search_places",
        title = "Search places",
        description =
            """
            Searches stops, addresses and points of interest by name (geocoding), or lists what is near coordinates
            (reverse geocoding when 'text' is 'lat,lon'). Returns stop ids usable by the other tools.
            """.trimIndent(),
        schema = {
            string("text", "Name to search (e.g. 'Lyon Part-Dieu'), or 'lat,lon' for reverse geocoding.", required = true)
            stringArray("types", "Restricts the result types.", LOCATION_TYPES)
            string("near", "'lat,lon' to favor results near this position.")
            integer("limit", "Maximum number of results (default 10).", minimum = 1, maximum = 50)
            string("language", LANGUAGE_DESCRIPTION)
        },
    ) { args ->
        val text = args.requireString("text")
        val limit = args.int("limit") ?: 10
        val coordinates = MotisGateway.parseCoordinates(text)
        val matches =
            if (coordinates != null) {
                gateway.reverseGeocode(coordinates.first, coordinates.second, limit)
            } else {
                gateway.geocode(
                    text = text,
                    types =
                        args.stringList("types")?.mapNotNull { type ->
                            LocationType.entries.firstOrNull { it.name.equals(type, ignoreCase = true) && it.name in LOCATION_TYPES }
                        },
                    near = args.string("near"),
                    numResults = limit,
                    language = args.stringList("language"),
                )
            }
                // a stop without lines (e.g. a copy of a station in another feed) has no departures: after the others
                .sortedBy { it.type == LocationType.STOP && it.modes.isNullOrEmpty() }
                .take(limit)
        val result = SearchResult(query = text, matches = matches.map { it.toDto() })
        val summary =
            if (result.matches.isEmpty()) {
                "No place found for \"$text\"."
            } else {
                // ids quoted: some end with ":" (e.g. SNCF stops), taken for punctuation and dropped by the models when not quoted
                result.matches.joinToString("\n", "${result.matches.size} result(s) for \"$text\":\n") { m ->
                    "- ${m.name} [${m.type}] id=\"${m.id}\" (${m.lat},${m.lon})" +
                        (m.area?.let { " — $it" } ?: "") +
                        when {
                            m.modes != null -> " modes=${m.modes.joinToString(",")}"
                            m.type == "STOP" -> " no lines"
                            else -> ""
                        }
                }
            }
        ToolOutput.of(summary, SearchResult.serializer(), result)
    }

    motisTool(
        name = "server_info",
        title = "MOTIS server information",
        description =
            "Describes the MOTIS server: version, real-time and shared mobility (GBFS) availability, limits, default map position.",
    ) {
        val health = gateway.health()
        val initial = gateway.initial()
        val config = initial.serverConfig
        val result =
            ServerInfoResult(
                baseUrl = baseUrl,
                motisVersion = config.motisVersion,
                realTime = health.rt,
                gbfs = health.gbfs,
                hasElevation = config.hasElevation,
                hasStreetRouting = config.hasStreetRouting,
                maxOneToAllTravelTimeMinutes = config.maxOneToAllTravelTimeLimit,
                initialView = Coordinates(initial.lat, initial.lon),
                initialZoom = initial.zoom,
            )
        ToolOutput.of(
            """
            MOTIS ${result.motisVersion} at ${result.baseUrl}
            real-time: ${result.realTime ?: "unknown"}, shared mobility (GBFS): ${result.gbfs ?: "unknown"}
            street routing: ${result.hasStreetRouting}, elevation: ${result.hasElevation}
            max one-to-all travel time: ${result.maxOneToAllTravelTimeMinutes} min
            """.trimIndent(),
            ServerInfoResult.serializer(),
            result,
        )
    }
}
