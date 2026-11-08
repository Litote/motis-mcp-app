package org.litote.motis.mcp.dto

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class ItineraryStopsTest {
    private fun place(name: String, track: String? = null) = PlaceDto(name, 48.8, 2.3, name.lowercase(), track = track)

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
                leg("WALK", place("Home"), massy, "07:00", "07:10"),
                leg("HIGHSPEED_RAIL", massy, tours, "07:12", "08:03", "ouigo"),
                leg("WALK", tours, tours, "08:03", "08:05"),
                leg("REGIONAL_RAIL", tours, nantes, "08:24", "10:09", "ter"),
                leg("WALK", nantes, place("Office"), "10:09", "10:20"),
            ).withStops()

        // the times of the boarding and of the leaving, not those of the walks
        assertEquals(ItineraryStop("Massy TGV", "massy tgv", "07:12", "2"), stops.departure)
        assertEquals(ItineraryStop("Nantes", "nantes", "10:09", "47"), stops.arrival)
        assertEquals(listOf("Saint-Pierre-des-Corps"), stops.transferStops)
    }

    @Test
    fun `a direct train has no transfer stop, a walk no stop`() {
        val direct = itinerary(leg("HIGHSPEED_RAIL", place("Paris Montparnasse"), place("Nantes"), "05:32", "07:54", "tgv")).withStops()
        assertEquals("Paris Montparnasse", direct.departure?.name)
        assertNull(direct.transferStops)

        val walk = itinerary(leg("WALK", place("Home"), place("Office"), "07:00", "07:20")).withStops()
        assertNull(walk.departure)
        assertNull(walk.arrival)
        assertNull(walk.transferStops)
    }
}
