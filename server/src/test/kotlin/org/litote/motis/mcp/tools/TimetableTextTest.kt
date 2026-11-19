package org.litote.motis.mcp.tools

import org.litote.motis.mcp.dto.DeparturesResult
import org.litote.motis.mcp.dto.ItineraryDto
import org.litote.motis.mcp.dto.LegDto
import org.litote.motis.mcp.dto.PlaceDto
import org.litote.motis.mcp.dto.Polyline
import org.litote.motis.mcp.dto.StationLineDto
import org.litote.motis.mcp.dto.StopCallDto
import org.litote.motis.mcp.dto.StopTimeDto
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TimetableTextTest {
    private val tz = "Europe/Paris"

    private fun place(name: String) = PlaceDto(name, 45.76, 4.86, name.lowercase(), tz = tz)

    private fun leg(
        mode: String,
        from: String,
        to: String,
        start: String,
        end: String,
        scheduledStart: String = start,
        scheduledEnd: String = end,
        tripId: String? = null,
    ) = LegDto(mode, place(from), place(to), start, end, scheduledStart, scheduledEnd, 60, realTime = true, tripId = tripId, polyline = Polyline(""))

    @Test
    fun `an itinerary gives the scheduled times of a late vehicle, not of the walks following it`() {
        val itinerary =
            ItineraryDto(
                startTime = "2026-11-19T15:07:00Z",
                endTime = "2026-11-19T15:20:00Z",
                durationSeconds = 780,
                transfers = 0,
                legs =
                    listOf(
                        leg("HIGHSPEED_RAIL", "Lyon Part Dieu", "Lyon Perrache", "2026-11-19T15:07:00Z", "2026-11-19T15:15:00Z", "2026-11-19T15:02:00Z", "2026-11-19T15:10:00Z", tripId = "t"),
                        leg("WALK", "Lyon Perrache", "Place Carnot", "2026-11-19T15:15:00Z", "2026-11-19T15:20:00Z", "2026-11-19T15:10:00Z", "2026-11-19T15:15:00Z"),
                    ),
            )

        val text = itinerary.describe()

        assertTrue(text.contains("16:07 (scheduled 16:02) Lyon Part Dieu — HIGHSPEED_RAIL — 16:15 (scheduled 16:10) Lyon Perrache"), text)
        assertTrue(text.contains("  16:15 Lyon Perrache — WALK — 16:20 Place Carnot"), text)
    }

    @Test
    fun `a stop of a trip gives its arrival and departure when the vehicle waits, with their scheduled times`() {
        val stop =
            place("Lyon Part Dieu").copy(
                arrival = "2026-11-19T15:01:00Z",
                departure = "2026-11-19T15:07:00Z",
                scheduledArrival = "2026-11-19T14:56:00Z",
                scheduledDeparture = "2026-11-19T15:02:00Z",
            )

        assertEquals("  - 16:01 (scheduled 15:56) → 16:07 (scheduled 16:02) Lyon Part Dieu", stop.tripStopLine(realTime = true))
        assertEquals("  - 16:01 → 16:07 Lyon Part Dieu", stop.tripStopLine(realTime = false))
    }

    @Test
    fun `a stop of a trip on time and without wait has one time, its track and cancellation`() {
        val stop =
            place("Le Creusot-TGV").copy(
                track = "3",
                arrival = "2026-11-19T14:15:00Z",
                departure = "2026-11-19T14:15:00Z",
                scheduledArrival = "2026-11-19T14:15:00Z",
                scheduledDeparture = "2026-11-19T14:15:00Z",
                cancelled = true,
            )

        assertEquals("  - 15:15 Le Creusot-TGV (track 3) CANCELLED", stop.tripStopLine(realTime = true))
        assertEquals("  - 15:15 Le Creusot-TGV", stop.copy(departure = null, track = null, cancelled = null).tripStopLine(realTime = true))
    }

    @Test
    fun `an arrival gives where it comes from, its destination often being the station`() {
        val arrival =
            StopTimeDto(
                time = "2026-11-19T19:55:00Z",
                scheduledTime = "2026-11-19T19:55:00Z",
                realTime = false,
                cancelled = false,
                mode = "HIGHSPEED_RAIL",
                line = "FR 9754",
                headsign = "Milano Centrale",
                agency = "TRENITALIA",
                tripId = "t",
                stops = listOf(StopCallDto("Roma Termini", "2026-11-19T17:00:00Z"), StopCallDto("Bologna Centrale", "2026-11-19T19:00:00Z")),
            )
        val board = DeparturesResult(stop = place("Milano Centrale"), arriveBy = true, stopTimes = listOf(arrival, arrival.copy(stops = null)))

        assertTrue(board.summary().contains("- 20:55 HIGHSPEED_RAIL FR 9754 from Roma Termini → Milano Centrale tripId"), board.summary())
        assertTrue(board.summary().contains("- 20:55 HIGHSPEED_RAIL FR 9754 → Milano Centrale tripId"), board.summary())
        assertTrue(board.copy(arriveBy = false).summary().contains("- 20:55 HIGHSPEED_RAIL FR 9754 → Milano Centrale tripId"))
    }

    @Test
    fun `a line of a station without agency has no empty parentheses`() {
        val board =
            DeparturesResult(
                stop = place("Lyon Part Dieu"),
                arriveBy = false,
                stopTimes = emptyList(),
                stationLines = listOf(StationLineDto("LONG_DISTANCE", "IC", ""), StationLineDto("LONG_DISTANCE", "IC", "SNCF VOYAGEURS")),
            )

        assertTrue(board.summary().contains("- LONG_DISTANCE: IC, IC (SNCF VOYAGEURS)"), board.summary())
    }
}
