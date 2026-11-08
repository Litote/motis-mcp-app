package org.litote.motis.mcp.dto

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class ItineraryStopsTest {
    private fun place(name: String, track: String? = null) = PlaceDto(name, 48.8, 2.3, name.lowercase(), track = track, tz = "Europe/Paris")

    private fun leg(mode: String, from: PlaceDto, to: PlaceDto, start: String, end: String, tripId: String? = null) =
        LegDto(mode, from, to, start, end, start, end, 60, realTime = false, tripId = tripId, polyline = Polyline(""))

    private fun itinerary(vararg legs: LegDto) =
        ItineraryDto(legs.first().startTime, legs.last().endTime, 600, legs.count { it.tripId != null } - 1L, legs.toList())

    @Test
    fun `the stops are those of the vehicles, not of the walks around them`() {
        val massy = place("Massy TGV", track = "2")
        val tours = place("Saint-Pierre-des-Corps")
        val nantes = place("Nantes", track = "47")
        val stops =
            itinerary(
                leg("WALK", place("Home"), massy, "2026-11-09T06:00:00Z", "2026-11-09T06:10:00Z"),
                leg("HIGHSPEED_RAIL", massy, tours, "2026-11-09T07:12:00Z", "2026-11-09T08:03:00Z", "ouigo"),
                leg("WALK", tours, tours, "2026-11-09T08:03:00Z", "2026-11-09T08:05:00Z"),
                leg("REGIONAL_RAIL", tours, nantes, "2026-11-09T08:24:00Z", "2026-11-09T10:09:00Z", "ter"),
                leg("WALK", nantes, place("Office"), "2026-11-09T10:09:00Z", "2026-11-09T10:20:00Z"),
            ).withStops()

        // the times of the boarding and of the leaving, not those of the walks; in UTC and in the time of the stop
        assertEquals(ItineraryStop("Massy TGV", "massy tgv", "2026-11-09T07:12:00Z", "2026-11-09T08:12:00+01:00", "2"), stops.departure)
        assertEquals(ItineraryStop("Nantes", "nantes", "2026-11-09T10:09:00Z", "2026-11-09T11:09:00+01:00", "47"), stops.arrival)
        assertEquals(listOf("Saint-Pierre-des-Corps"), stops.transferStops)
    }

    @Test
    fun `a direct train has no transfer stop, a walk no stop`() {
        val direct = itinerary(leg("HIGHSPEED_RAIL", place("Paris Montparnasse"), place("Nantes"), "2026-11-09T05:32:00Z", "2026-11-09T07:54:00Z", "tgv")).withStops()
        assertEquals("Paris Montparnasse", direct.departure?.name)
        assertNull(direct.transferStops)
        // summer time
        assertEquals("2026-07-01T07:32:00+02:00", localTime("2026-07-01T05:32:00Z", "Europe/Paris"))
        assertNull(localTime("2026-07-01T05:32:00Z", null))
        assertNull(localTime("2026-07-01T05:32:00Z", "Not/AZone"))

        val walk = itinerary(leg("WALK", place("Home"), place("Office"), "2026-11-09T06:00:00Z", "2026-11-09T06:20:00Z")).withStops()
        assertNull(walk.departure)
        assertNull(walk.arrival)
        assertNull(walk.transferStops)
    }
}
