package org.litote.motis.mcp.tools

import io.modelcontextprotocol.kotlin.sdk.server.Server
import org.litote.motis.mcp.MotisGateway
import org.litote.motis.mcp.MotisToolException
import org.litote.motis.mcp.UnknownStopException
import org.litote.motis.mcp.apps.UiView
import org.litote.motis.mcp.dto.DeparturesResult
import org.litote.motis.mcp.dto.ItineraryDto
import org.litote.motis.mcp.dto.TripResult
import org.litote.motis.mcp.dto.toDto

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

fun Server.addTimetableTools(gateway: MotisGateway) {
    motisTool(
        name = "departures",
        title = "Departures board",
        description =
            """
            Next departures (or arrivals) at a stop, with real-time delays, cancellations and tracks when available.
            Give 'stopId' (from search_places or explore_area) or a stop name in 'stop'.
            """.trimIndent(),
        view = UiView.DEPARTURES,
        schema = {
            string("stopId", "Exact stop id.")
            string("stop", "Stop name, resolved by geocoding (used when stopId is missing).")
            string("time", "Start date-time, ISO-8601 with offset. Default: now.")
            boolean("arriveBy", "true: arrivals instead of departures.")
            integer("count", "Number of departures (default 20).", minimum = 1, maximum = 100)
            stringArray("modes", "Only these transit modes.", TRANSIT_MODES)
            string("pageCursor", "Cursor returned by a previous call, to get the next or previous page.")
            string("language", LANGUAGE_DESCRIPTION)
        },
    ) { args ->
        val language = args.stringList("language")
        suspend fun resolveStop(): String? = args.string("stop")?.let { gateway.resolvePlace(it, stopsOnly = true, language = language).id }
        val stopId =
            args.string("stopId")
                ?: resolveStop()
                ?: throw MotisToolException("Invalid argument: 'stopId' or 'stop' is required")
        val arriveBy = args.boolean("arriveBy") ?: false
        suspend fun stopTimes(id: String) =
            gateway.stopTimes(
                stopId = id,
                time = args.instant("time"),
                arriveBy = arriveBy,
                n = args.int("count") ?: MotisGateway.DEFAULT_STOP_TIMES,
                modes = args.modes("modes"),
                pageCursor = args.string("pageCursor"),
                language = language,
            )
        val body =
            try {
                stopTimes(stopId)
            } catch (e: UnknownStopException) {
                // unknown stopId given with the stop name: use the name
                val resolved = if (args.string("stopId") != null) resolveStop() else null
                if (resolved == null || resolved == stopId) throw e
                stopTimes(resolved)
            }
        val result = body.toDto(arriveBy)
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
