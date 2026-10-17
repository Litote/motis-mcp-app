package org.litote.motis.mcp.tools

import io.modelcontextprotocol.kotlin.sdk.server.Server
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import org.litote.motis.client.model.Mode
import org.litote.motis.mcp.MotisGateway
import org.litote.motis.mcp.MotisToolException
import org.litote.motis.mcp.ResolvedPlace
import org.litote.motis.mcp.StopTimesQuery
import org.litote.motis.mcp.UnknownStopException
import org.litote.motis.mcp.apps.UiView
import org.litote.motis.mcp.dto.DeparturesResult
import org.litote.motis.mcp.dto.ItineraryDto
import org.litote.motis.mcp.dto.STATION_RADIUS
import org.litote.motis.mcp.dto.StationLineDto
import org.litote.motis.mcp.dto.TripResult
import org.litote.motis.mcp.dto.distinctTrains
import org.litote.motis.mcp.dto.followedBy
import org.litote.motis.mcp.dto.label
import org.litote.motis.mcp.dto.onLines
import org.litote.motis.mcp.dto.stationLines
import org.litote.motis.mcp.dto.toDto
import org.litote.motis.mcp.dto.withNearbyTrains
import kotlin.time.Instant

/** Modes of the trains: RAIL also includes the metros for MOTIS. */
private val TRAIN_MODES =
    listOf(Mode.HIGHSPEED_RAIL, Mode.LONG_DISTANCE, Mode.NIGHT_RAIL, Mode.REGIONAL_FAST_RAIL, Mode.REGIONAL_RAIL, Mode.SUBURBAN)

private val RAIL_LABELS = TRAIN_MODES.map { it.label() } + Mode.RAIL.label()

private fun DeparturesResult.summary(): String =
    buildString {
        val what = if (arriveBy) "Arrivals" else "Departures"
        appendLine("$what at ${stop.name} (stopId=${stop.stopId}):")
        if (stopTimes.isEmpty()) appendLine("none in the requested period.")
        stopTimes.forEach { st ->
            val delay = if (st.realTime && st.time != st.scheduledTime) " (scheduled ${hhmm(st.scheduledTime, stop.tz)})" else ""
            val cancelled = if (st.cancelled) " CANCELLED" else ""
            val track = st.track?.let { " track $it" } ?: ""
            appendLine("- ${hhmm(st.time, stop.tz)}$delay ${st.mode} ${st.line} → ${st.headsign}$track$cancelled tripId=${st.tripId}")
        }
        stationLines?.let { lines ->
            appendLine("Lines of the station (departures with station=true, modes and lines):")
            lines.groupBy { it.mode }.forEach { (mode, l) -> appendLine("- $mode: ${l.joinToString { "${it.line} (${it.agency})" }}") }
        }
    }.trimEnd()

/** Text description of an itinerary, one line per leg. */
internal fun ItineraryDto.describe(): String =
    buildString {
        val tz = legs.firstOrNull()?.from?.tz
        appendLine(
            "${hhmm(startTime, tz)} → ${hhmm(endTime, legs.lastOrNull()?.to?.tz)}, ${durationSeconds / 60} min, $transfers transfer(s)",
        )
        legs.forEach { leg ->
            val line = leg.line?.let { " $it" } ?: ""
            val headsign = leg.headsign?.let { " → $it" } ?: ""
            appendLine(
                "  ${hhmm(leg.startTime, leg.from.tz)} ${leg.from.name} — ${leg.mode}$line$headsign — " +
                    "${hhmm(leg.endTime, leg.to.tz)} ${leg.to.name}",
            )
        }
    }.trimEnd()

/**
 * Families of the lines of a station, each probed with its next stop times (MOTIS has no list of the lines of a stop): the
 * long-distance trains, the other trains, metros, trams, buses.
 */
private val STATION_FAMILIES =
    listOf(
        listOf(Mode.HIGHSPEED_RAIL, Mode.LONG_DISTANCE, Mode.NIGHT_RAIL),
        listOf(Mode.REGIONAL_FAST_RAIL, Mode.REGIONAL_RAIL, Mode.SUBURBAN),
        listOf(Mode.SUBWAY, Mode.METRO),
        listOf(Mode.TRAM),
        listOf(Mode.BUS, Mode.COACH),
    )

/** Stop times probed per family: enough to find the lines of a big station, without the next stops of the trips. */
private const val STATION_PROBE = 40

/** Pages of MOTIS read to find [n] stop times of the requested lines. */
private const val LINE_PAGES = 4

/** Departures (or arrivals) asked by the arguments of the departures tool. */
private class DeparturesRequest(private val gateway: MotisGateway, private val args: Args) {
    private val language = args.stringList("language")
    private val arriveBy = args.boolean("arriveBy") ?: false
    private val n = args.int("count") ?: MotisGateway.DEFAULT_STOP_TIMES
    private val modes = args.modes("modes")
    private val station = args.boolean("station") ?: false
    private val lines = args.stringList("lines")?.toSet()
    private val pageCursor = args.string("pageCursor")
    private val earlier = pageCursor?.startsWith("EARLIER") == true

    /** Start time, set once the stop is known: a time without offset is in the time zone of the stop. */
    private var time: Instant? = null

    suspend fun departures(): DeparturesResult {
        val stopId = args.string("stopId")
        val stop =
            // only the id of a stop given by id is known (its time zone is asked to MOTIS if needed)
            stopId?.let { ResolvedPlace(it, it, 0.0, 0.0, isStop = true) }
                ?: resolveStop()
                ?: throw MotisToolException("Invalid argument: 'stopId' or 'stop' is required")
        return try {
            departures(stop)
        } catch (e: UnknownStopException) {
            // unknown stopId given with the stop name: use the name
            val resolved = if (stopId != null) resolveStop() else null
            if (resolved == null || resolved.id == stop.id) throw e
            departures(resolved)
        }
    }

    private suspend fun resolveStop(): ResolvedPlace? = args.string("stop")?.let { gateway.resolvePlace(it, stopsOnly = true, language = language) }

    private suspend fun departures(stop: ResolvedPlace): DeparturesResult {
        time = args.instant("time") { stop.tz ?: gateway.stop(stop.id)?.tz }
        return if (station) stationStopTimes(stop.id) else withNearbyTrains(stop.id)
    }

    private suspend fun stopTimes(
        id: String,
        modes: List<Mode>?,
        radius: Long? = null,
        cursor: String? = pageCursor,
        count: Int = n,
        fetchStops: Boolean = true,
    ) = gateway.stopTimes(
        StopTimesQuery(
            stopId = id,
            time = time,
            arriveBy = arriveBy,
            n = count,
            modes = modes,
            pageCursor = cursor,
            language = language,
            radius = radius,
            fetchStops = fetchStops,
        ),
    ).toDto(arriveBy)

    /** All the stops of the station: pages of MOTIS read until n stop times of the requested lines. */
    private suspend fun stationStopTimes(id: String): DeparturesResult {
        var page = stopTimes(id, modes, STATION_RADIUS).distinctTrains()
        // the whole board of the station (asked by the model): its lines, for the tabs
        val lines = lines ?: return if (modes == null) page.withStationLines(id) else page
        var result = page.onLines(lines)
        repeat(LINE_PAGES - 1) {
            val cursor = (if (earlier) page.previousPageCursor else page.nextPageCursor) ?: return result
            if (result.stopTimes.size >= n) return result
            page = stopTimes(id, modes, STATION_RADIUS, cursor)
            result = result.followedBy(page.onLines(lines), earlier)
        }
        return result
    }

    /**
     * The trains of a station may be at stops of other feeds, e.g. the TGV of the IDFM stop "Gare de Lyon". A stop without
     * stop times may be a copy of a station in another feed, e.g. "Lyon Part Dieu (FR)" of the SNCB: its trains are nearby.
     */
    private suspend fun withNearbyTrains(id: String): DeparturesResult {
        val result = stopTimes(id, modes)
        val trainModes = modes?.let { m -> if (Mode.RAIL in m) TRAIN_MODES else TRAIN_MODES.filter { it in m } } ?: TRAIN_MODES
        if (trainModes.isEmpty() || result.stopTimes.isNotEmpty() && result.stopTimes.none { it.mode in RAIL_LABELS }) return result
        val nearby = stopTimes(id, trainModes, STATION_RADIUS)
        return result.withNearbyTrains(nearby, n, earlier).withStationLines(id)
    }

    /** Lines of the station of a board with trains. */
    private suspend fun DeparturesResult.withStationLines(id: String): DeparturesResult =
        if (stopTimes.none { it.mode in RAIL_LABELS }) this else copy(stationLines = stationLines(id).takeIf { it.isNotEmpty() })

    /**
     * Lines of a railway station, for the tabs of the first page of its board. They are found from the next departures
     * of the probe time: only those of now are cached, a given time may be a quiet period with fewer lines.
     */
    private suspend fun stationLines(id: String): List<StationLineDto> =
        when {
            pageCursor != null -> emptyList()
            time != null -> stationLines(probes(id))
            else -> gateway.stationLines.getOrPut(id to language) { stationLines(probes(id)) }
        }

    private suspend fun probes(id: String): List<DeparturesResult> =
        coroutineScope {
            STATION_FAMILIES
                .map { family -> async { stopTimes(id, family, STATION_RADIUS, null, STATION_PROBE, fetchStops = false) } }
                .awaitAll()
        }
}

fun Server.addTimetableTools(gateway: MotisGateway) {
    motisTool(
        name = "departures",
        title = "Departures board",
        description =
            """
            Next departures (or arrivals) at a stop, with real-time delays, cancellations and tracks when available.
            Give 'stopId' (from search_places or explore_area) or a stop name in 'stop'.
            For a railway station, the first page also lists the lines of the station (all its stops within 200 m): their
            departures are given by 'station' true, with 'modes' and 'lines'.
            """.trimIndent(),
        view = UiView.DEPARTURES,
        schema = {
            string("stopId", "Exact stop id.")
            string("stop", "Stop name, resolved by geocoding (used when stopId is missing).")
            string("time", "Start date-time, ISO-8601: with offset, or in the local time of the stop. Default: now.")
            boolean("arriveBy", "true: arrivals instead of departures.")
            integer("count", "Number of departures (default 20).", minimum = 1, maximum = 100)
            stringArray("modes", "Only these transit modes.", TRANSIT_MODES)
            boolean("station", "true: departures of all the stops of the station (within 200 m), not only of this stop.")
            stringArray("lines", "Only these lines of the station (names listed in the station lines), with 'station' true.")
            string("pageCursor", "Cursor returned by a previous call, to get the next or previous page.")
            string("language", LANGUAGE_DESCRIPTION)
        },
    ) { args ->
        val result = DeparturesRequest(gateway, args).departures()
        ToolOutput.of(result.summary(), DeparturesResult.serializer(), result)
    }

    motisTool(
        name = "trip_details",
        title = "Trip details",
        description = "All the stops of a trip (one vehicle run) with their times. 'tripId' comes from departures or plan_journey.",
        view = UiView.DEPARTURES,
        schema = {
            string("tripId", "Trip id.", required = true)
            string("language", LANGUAGE_DESCRIPTION)
        },
    ) { args ->
        val tripId = args.requireString("tripId")
        val itinerary = gateway.trip(tripId, args.stringList("language")).toDto()
        val result = TripResult(tripId = tripId, itinerary = itinerary)
        val summary =
            buildString {
                appendLine(itinerary.describe())
                itinerary.legs.filter { it.tripId != null }.forEach { leg ->
                    val stops = listOf(leg.from) + leg.intermediateStops.orEmpty() + leg.to
                    stops.forEach { s -> appendLine("  - ${hhmm(s.departure ?: s.arrival, s.tz)} ${s.name}${s.track?.let { " (track $it)" } ?: ""}") }
                }
            }.trimEnd()
        ToolOutput.of(summary, TripResult.serializer(), result)
    }
}
