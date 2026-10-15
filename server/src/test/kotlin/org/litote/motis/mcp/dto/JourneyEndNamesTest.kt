package org.litote.motis.mcp.dto

import kotlin.test.Test
import kotlin.test.assertEquals

class JourneyEndNamesTest {
    private fun place(name: String, stopId: String? = null) = PlaceDto(name, 48.8, 2.3, stopId)

    private fun leg(mode: String, from: PlaceDto, to: PlaceDto) =
        LegDto(mode, from, to, "t", "t", "t", "t", 60, realTime = false, polyline = Polyline(""))

    private val journey =
        JourneyResult(
            from = place("START"),
            to = place("Versailles", "stop-2"),
            itineraries =
                listOf(
                    ItineraryDto(
                        "t",
                        "t",
                        600,
                        0,
                        listOf(
                            leg("BIKE", place("START"), place("Austerlitz", "stop-1")),
                            leg("RAIL", place("Austerlitz", "stop-1"), place("Versailles", "stop-2")),
                        ),
                    ),
                ),
            direct = listOf(ItineraryDto("t", "t", 600, 0, listOf(leg("BIKE", place("START"), place("END"))))),
        )

    @Test
    fun `ends sent as coordinates are named after the places asked`() {
        val named = journey.withEndNames("Gare de Lyon", "Château de Versailles")

        assertEquals("Gare de Lyon", named.from.name)
        // stops keep their names
        assertEquals("Versailles", named.to.name)
        val legs = named.itineraries.single().legs
        assertEquals(listOf("Gare de Lyon", "Austerlitz"), legs.map { it.from.name })
        assertEquals(listOf("Austerlitz", "Versailles"), legs.map { it.to.name })
        assertEquals("Château de Versailles", named.direct.single().legs.single().to.name)
    }

    @Test
    fun `places given as coordinates keep the MOTIS names`() {
        assertEquals(journey, journey.withEndNames(null, null))
    }
}
