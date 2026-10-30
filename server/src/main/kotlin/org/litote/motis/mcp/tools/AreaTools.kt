package org.litote.motis.mcp.tools

import io.modelcontextprotocol.kotlin.sdk.server.Server
import org.litote.motis.mcp.BoundingBox
import org.litote.motis.mcp.MotisGateway
import org.litote.motis.mcp.MotisToolException
import org.litote.motis.mcp.ResolvedPlace
import org.litote.motis.mcp.apps.UiView
import org.litote.motis.mcp.dto.AreaResult
import org.litote.motis.mcp.dto.PlaceDto
import org.litote.motis.mcp.dto.ReachabilityResult
import org.litote.motis.mcp.dto.routeName
import org.litote.motis.mcp.dto.toAreaResult
import org.litote.motis.mcp.dto.toDto
import kotlin.math.roundToInt

private const val DEFAULT_RADIUS_KM = 1.5
private const val MAX_RADIUS_KM = 50.0

/** Area given either by a place and a radius, or by explicit bounds. */
internal suspend fun Args.area(gateway: MotisGateway): Pair<String, BoundingBox> {
    val minLat = double("minLat")
    val minLon = double("minLon")
    val maxLat = double("maxLat")
    val maxLon = double("maxLon")
    if (minLat != null && minLon != null && maxLat != null && maxLon != null) {
        if (minLat >= maxLat || minLon >= maxLon) throw MotisToolException("Invalid argument: min must be south-west of max")
        return "($minLat,$minLon)–($maxLat,$maxLon)" to BoundingBox(minLat, minLon, maxLat, maxLon)
    }
    val place = string("place") ?: throw MotisToolException("Invalid argument: 'place' or the four bounds are required")
    val radius = (double("radiusKm") ?: DEFAULT_RADIUS_KM).coerceIn(0.1, MAX_RADIUS_KM)
    val resolved = gateway.resolvePlace(place, language = stringList("language"))
    return "${resolved.name} (${(radius * 10).roundToInt() / 10.0} km)" to BoundingBox.around(resolved.lat, resolved.lon, radius)
}

internal fun SchemaBuilder.areaArguments() {
    string("place", "Center of the area: place name, stop name or 'lat,lon'.")
    number("radiusKm", "Radius around 'place' in km (default $DEFAULT_RADIUS_KM, max $MAX_RADIUS_KM).")
    number("minLat", "South bound (instead of place/radiusKm).")
    number("minLon", "West bound (instead of place/radiusKm).")
    number("maxLat", "North bound (instead of place/radiusKm).")
    number("maxLon", "East bound (instead of place/radiusKm).")
}

private fun AreaResult.summary(): String =
    buildString {
        appendLine("$title: $totalStops stop(s), $totalRoutes route(s)${if (zoomFiltered) " (minor routes hidden at this zoom level: reduce the radius)" else ""}.")
        if (routes.isNotEmpty()) {
            appendLine("Routes (routeIdx: mode names):")
            routes.take(40).forEach { appendLine("- ${it.routeIdx}: ${it.mode} ${it.names.joinToString(", ")} (${it.numStops} stops)") }
            if (routes.size > 40) appendLine("- … ${routes.size - 40} more")
        }
        if (stops.isNotEmpty()) {
            appendLine("Main stops (stopId):")
            stops.take(20).forEach { appendLine("- ${it.name} (\"${it.stopId}\")${it.modes?.let { m -> " ${m.joinToString(",")}" } ?: ""}") }
        }
    }.trimEnd()

private fun ResolvedPlace.toDto(): PlaceDto = PlaceDto(name = name, lat = lat, lon = lon, stopId = id.takeIf { isStop }, area = area)

fun Server.addAreaTools(gateway: MotisGateway) {
    motisTool(
        name = "explore_area",
        title = "Explore an area",
        description =
            """
            Shows on a map the public transport stops and routes (lines) of an area, given by a place and a radius
            or by bounds. Use it to discover which transit data is available somewhere.
            The returned routeIdx values can be passed to route_details, the stopId values to departures.
            """.trimIndent(),
        view = UiView.EXPLORER,
        schema = {
            areaArguments()
            stringArray("modes", "Only the stops and routes of these modes.", TRANSIT_MODES)
            string("language", LANGUAGE_DESCRIPTION)
        },
    ) { args ->
        val (title, bbox) = args.area(gateway)
        val zoom = BoundingBox.zoomFor(bbox.radiusKm)
        val language = args.stringList("language")
        val modes = args.modes("modes")
        val (stops, routes) = gateway.area(bbox, zoom, modes, language)
        // filtered here as well: MOTIS (Transitous) ignores the modes of the stops, and the routes have none
        val result = routes.toAreaResult(title, bbox, zoom, stops, modes)
        ToolOutput.of(result.summary(), AreaResult.serializer(), result)
    }

    motisTool(
        name = "route_details",
        title = "Route details",
        description = "Shows a route (line) on a map with all its stops and its shape. 'routeIdx' comes from explore_area.",
        view = UiView.EXPLORER,
        schema = {
            integer("routeIdx", "Route index returned by explore_area.", required = true, minimum = 0)
            string("language", LANGUAGE_DESCRIPTION)
        },
    ) { args ->
        val routeIdx = args.long("routeIdx") ?: throw MotisToolException("Invalid argument: 'routeIdx' is required")
        val details = gateway.routeDetails(routeIdx, args.stringList("language"))
        val route = details.routes.firstOrNull { it.routeIdx == routeIdx } ?: details.routes.firstOrNull()
        val name = route?.let { r -> "${r.mode.serialName()} ${r.transitRoutes.joinToString(", ") { routeName(it.shortName, it.longName) }}" }
        val result = details.toAreaResult(name ?: "Route $routeIdx")
        ToolOutput.of(
            "${result.title}: ${result.stops.size} stop(s): ${result.stops.joinToString(" → ") { it.name }}",
            AreaResult.serializer(),
            result,
        )
    }

    motisTool(
        name = "reachability",
        title = "Reachable places",
        description =
            """
            Computes every stop reachable from (or, with arriveBy, to) a place by public transport within a maximum
            travel time (isochrone), and shows them on a map colored by travel time.
            """.trimIndent(),
        view = UiView.EXPLORER,
        schema = {
            string("place", "Origin: place name, stop name, stop id or 'lat,lon'.", required = true)
            integer("maxTravelTimeMinutes", "Maximum travel time in minutes (default 30).", minimum = 1, maximum = 240)
            string("time", "Departure (or arrival) date-time, ISO-8601: with offset, or in the local time of the place. Default: now.")
            boolean("arriveBy", "true: places from which 'place' can be reached.")
            integer("maxTransfers", "Maximum number of transfers.", minimum = 0, maximum = 10)
            stringArray("modes", "Allowed transit modes (default: all).", TRANSIT_MODES)
            // MOTIS one-to-all has no language: the reachable stops keep the names of the timetable
            string("language", "Preferred language of the origin name, as ISO 639-1 code (e.g. fr, de).")
        },
    ) { args ->
        val origin = gateway.resolvePlace(args.requireString("place"), language = args.stringList("language"))
        val maxTravelTime = args.int("maxTravelTimeMinutes") ?: 30
        val reachable =
            gateway.oneToAll(
                one = origin.id,
                maxTravelTimeMinutes = maxTravelTime,
                time = args.instant("time") { gateway.timeZone(origin) },
                arriveBy = args.boolean("arriveBy") ?: false,
                maxTransfers = args.int("maxTransfers"),
                transitModes = args.modes("modes"),
            )
        val result = reachable.toDto(origin.toDto(), maxTravelTime)
        val summary =
            buildString {
                appendLine("${result.totalPlaces} stop(s) reachable from ${origin.name} within $maxTravelTime min.")
                result.places.groupBy { ((it.durationMinutes ?: 0) / 10) * 10 }.toSortedMap().forEach { (bucket, places) ->
                    appendLine("- $bucket–${bucket + 9} min: ${places.size} stop(s), e.g. ${places.map { it.name }.distinct().take(5).joinToString(", ")}")
                }
            }.trimEnd()
        ToolOutput.of(summary, ReachabilityResult.serializer(), result)
    }
}
