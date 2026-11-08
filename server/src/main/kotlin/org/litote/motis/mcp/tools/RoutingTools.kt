package org.litote.motis.mcp.tools

import io.modelcontextprotocol.kotlin.sdk.server.Server
import org.litote.motis.mcp.BikeOption
import org.litote.motis.mcp.MotisGateway
import org.litote.motis.mcp.MotisToolException
import org.litote.motis.mcp.PlanQuery
import org.litote.motis.mcp.ResolvedPlace
import org.litote.motis.mcp.TransferMargin
import org.litote.motis.mcp.WalkingSpeed
import org.litote.motis.mcp.apps.UiView
import org.litote.motis.mcp.cities.CityJourneys
import org.litote.motis.mcp.dto.Coordinates
import org.litote.motis.mcp.dto.ItineraryDto
import org.litote.motis.mcp.dto.JourneyResult
import org.litote.motis.mcp.dto.fromMainLineStations
import org.litote.motis.mcp.dto.hasMainLineLegs
import org.litote.motis.mcp.dto.toDto
import org.litote.motis.mcp.dto.withEndNames
import org.litote.motis.mcp.dto.withStops

fun Server.addRoutingTools(gateway: MotisGateway, cityJourneys: CityJourneys) {
    motisTool(
        name = "plan_journey",
        title = "Plan a journey",
        description =
            """
            Computes public transport itineraries between two places (names, stop ids or 'lat,lon'),
            with walking legs, transfers and real-time data. Shows them as a list and on a map.
            Give it the place names of the user as they are: no need to search them first.
            Fails listing the candidates when a name is ambiguous: call it again with the value given for the right one.
            Between city names (e.g. 'Paris' to 'Nantes'), the long-distance itineraries start and end at the stations,
            without the local legs to/from the city center; give an address for door-to-door itineraries.
            The itineraries do not all leave from (or arrive at) the same station: give the user the station of each one
            (departure, arrival: name, time, local time and track of the boarding in the first vehicle and of the leaving of the last one).
            """.trimIndent(),
        view = UiView.ITINERARY,
        schema = {
            string("from", "Origin: place name, stop id or 'lat,lon'. Default: 'position'.")
            string("to", "Destination: place name, stop id or 'lat,lon'. Names are searched near the origin.", required = true)
            string(
                "position",
                "Current position of the user, 'lat,lon': origin when 'from' is missing, else favors the places near it.",
            )
            string("time", "Departure (or arrival with arriveBy) date-time, ISO-8601: with offset, or in the local time of the origin. Default: now.")
            boolean("arriveBy", "true: 'time' is the latest arrival time.")
            stringArray("modes", "Allowed transit modes (default: all).", TRANSIT_MODES)
            integer("maxTransfers", "Maximum number of transfers.", minimum = 0, maximum = 10)
            integer(
                "maxWalkMinutes",
                "Maximum walk (or bike ride) to the first stop and from the last stop, in minutes " +
                    "(default ${MotisGateway.DEFAULT_MAX_WALK_MINUTES}): lower for a user who walks little.",
                minimum = 1,
                maximum = 60,
            )
            string("walkingSpeed", "Walking speed (default NORMAL, about 4.3 km/h).", enum = WalkingSpeed.entries.map { it.name })
            boolean("wheelchair", "true: accessible paths for a wheelchair user.")
            string(
                "transferMargin",
                "COMFORTABLE: 5 more minutes reserved for each transfer (default NORMAL).",
                enum = TransferMargin.entries.map { it.name },
            )
            string(
                "bike",
                "Bike of the user: TO_STATION (ridden to the first stop, then left there), " +
                    "ON_BOARD (carried on board, ridden at both ends; only trips allowing bikes). Default NONE.",
                enum = BikeOption.entries.map { it.name },
            )
            integer("count", "Minimum number of itineraries (default 5).", minimum = 1, maximum = 20)
            string("pageCursor", "Cursor returned by a previous call, for earlier or later itineraries.")
            string("language", LANGUAGE_DESCRIPTION)
        },
    ) { args ->
        val pageCursor = args.string("pageCursor")
        val walkingSpeed = args.enum<WalkingSpeed>("walkingSpeed") ?: WalkingSpeed.NORMAL
        val wheelchair = args.boolean("wheelchair") ?: false
        val transferMargin = args.enum<TransferMargin>("transferMargin") ?: TransferMargin.NORMAL
        val bike = args.enum<BikeOption>("bike") ?: BikeOption.NONE
        val language = args.stringList("language")
        val position = args.string("position")
        if (position != null && MotisGateway.parseCoordinates(position) == null) {
            throw MotisToolException("Invalid argument: 'position' must be 'lat,lon'")
        }
        val from =
            gateway.resolvePlace(
                args.string("from") ?: position ?: throw MotisToolException("Invalid argument: 'from' or 'position' is required"),
                argument = if (args.string("from") != null) "from" else "position",
                near = position,
                language = language,
            )
        val to = gateway.resolvePlace(args.requireString("to"), "to", near = from.coordinates(), language = language)
        // MOTIS rides a bike only from/to coordinates, not from/to stops
        val fromPlace = if (bike != BikeOption.NONE) from.coordinates() else from.id
        val toPlace = if (bike == BikeOption.ON_BOARD) to.coordinates() else to.id
        val query =
            PlanQuery(
                from = fromPlace,
                to = toPlace,
                time = args.instant("time") { gateway.timeZone(from) ?: gateway.timeZone(to) },
                arriveBy = args.boolean("arriveBy") ?: false,
                transitModes = args.modes("modes"),
                maxTransfers = args.int("maxTransfers"),
                maxWalkMinutes = args.int("maxWalkMinutes") ?: MotisGateway.DEFAULT_MAX_WALK_MINUTES,
                walkingSpeed = walkingSpeed,
                wheelchair = wheelchair,
                transferMargin = transferMargin,
                bike = bike,
                numItineraries = args.int("count"),
                pageCursor = pageCursor,
                language = language,
            )
        val journeys =
            if (from.isCity && to.isCity && bike == BikeOption.NONE) {
                // from station to station (a bike is ridden from the coordinates of the city)
                cityJourneys.plan(from, to, query)
            } else {
                gateway.plan(query).toDto().fromMainLineStations(from.center().takeIf { from.isCity }, to.center().takeIf { to.isCity })
            }
        val result = journeys.withEndNames(from.askedName(), to.askedName(), from.area, to.area).withStops()
        val options =
            listOfNotNull(
                walkingSpeed.takeIf { it != WalkingSpeed.NORMAL }?.let { "walking speed ${it.name}" },
                "wheelchair".takeIf { wheelchair },
                transferMargin.takeIf { it != TransferMargin.NORMAL }?.let { "transfer margin ${it.name}" },
                bike.takeIf { it != BikeOption.NONE }?.let { "bike ${it.name}" },
            )
        ToolOutput.of(journeySummary(from, to, result, options), JourneyResult.serializer(), result)
    }
}

private fun ResolvedPlace.coordinates(): String = "$lat,$lon"

/** Text of the journeys [result] from [from] to [to], with the non-default [options] of the search. */
private fun journeySummary(from: ResolvedPlace, to: ResolvedPlace, result: JourneyResult, options: List<String>): String =
    buildString {
        appendLine("From ${from.label} to ${to.label}: ${result.itineraries.size} itinerary(ies).")
        listOfNotNull(from.label.takeIf { from.isCity }, to.label.takeIf { to.isCity })
            .takeIf { it.isNotEmpty() && result.hasMainLineLegs() }
            ?.let { appendLine("Long-distance trains from/to the stations of ${it.joinToString(" and ")}, without the local legs to/from the city center.") }
        // from/to a city, the model takes the station of the first itinerary for all of them (from/to an address, the
        // stops differ anyway, and the legs say it)
        if (from.isCity) result.itineraries.differingStops("Departure stations") { it.departure?.name }?.let { appendLine(it) }
        if (to.isCity) result.itineraries.differingStops("Arrival stations") { it.arrival?.name }?.let { appendLine(it) }
        options.takeIf { it.isNotEmpty() }?.let { appendLine("Options: ${it.joinToString()}.") }
        result.itineraries.forEachIndexed { i, it -> appendLine("${i + 1}. ${it.describe()}") }
        result.direct.firstOrNull()?.let { appendLine("Direct (without transit): ${it.describe()}") }
    }.trimEnd()

/**
 * Warning listing the stops of the [itineraries] (with their numbers) when they differ, e.g. "Departure stations differ:
 * Paris Montparnasse (1, 2), Massy TGV (3)": else the model takes the station of the first one for all of them.
 */
private fun List<ItineraryDto>.differingStops(label: String, stop: (ItineraryDto) -> String?): String? {
    val numbers = withIndex().mapNotNull { (i, it) -> stop(it)?.let { name -> name to i + 1 } }.groupBy({ it.first }, { it.second })
    if (numbers.size < 2) return null
    return "$label differ: ${numbers.entries.joinToString { (name, n) -> "$name (${n.joinToString()})" }}: give the station of each itinerary."
}

private fun ResolvedPlace.center(): Coordinates = Coordinates(lat, lon)

/** Name of a place given by name (geocoded), null for coordinates: names the ends of a journey sent as coordinates. */
private fun ResolvedPlace.askedName(): String? = name.takeIf { MotisGateway.parseCoordinates(it) == null }
