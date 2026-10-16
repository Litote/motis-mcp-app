package org.litote.motis.mcp.dto

import kotlin.test.Test
import kotlin.test.assertEquals

class StationLinesTest {
    private fun at(hhmm: String) = "2026-10-16T$hhmm:00Z"

    private fun st(tripId: String, hhmm: String, mode: String, line: String, agency: String = "RER", number: String? = null) =
        StopTimeDto(at(hhmm), at(hhmm), false, false, mode, line, "Juvisy", agency = agency, tripId = tripId, trainNumber = number)

    private fun page(vararg stopTimes: StopTimeDto, previous: String = "EARLIER|1", next: String = "LATER|1") =
        DeparturesResult(
            stop = PlaceDto("Gare de Lyon", 48.8, 2.3, "IDFM:73626"),
            arriveBy = false,
            stopTimes = stopTimes.toList(),
            nextPageCursor = next,
            previousPageCursor = previous,
        )

    @Test
    fun `lists the lines of the station once, the trains by brand`() {
        val trains = page(st("tgv1", "17:30", "HIGHSPEED_RAIL", "TGV INOUI 6603", "SNCF"), st("tgv2", "17:35", "HIGHSPEED_RAIL", "TGV INOUI 6605", "SNCF"))
        val rer = page(st("a1", "17:31", "REGIONAL_RAIL", "A"), st("d1", "17:32", "REGIONAL_RAIL", "D"), st("a2", "17:33", "REGIONAL_RAIL", "A"))

        assertEquals(
            listOf(
                StationLineDto("HIGHSPEED_RAIL", "TGV INOUI", "SNCF"),
                StationLineDto("REGIONAL_RAIL", "A", "RER"),
                StationLineDto("REGIONAL_RAIL", "D", "RER"),
            ),
            stationLines(listOf(trains, page(), rer)),
        )
    }

    @Test
    fun `filters the lines and keeps a train of two feeds once`() {
        val result =
            page(
                st("d1", "17:32", "REGIONAL_RAIL", "D", number = "ZUMO83"),
                st("sncf-d1", "17:32", "REGIONAL_RAIL", "D", "SNCF", number = "ZUMO83"),
                st("a1", "17:31", "REGIONAL_RAIL", "A"),
                st("ter", "17:40", "REGIONAL_RAIL", "TER 891001", "SNCF"),
            )

        assertEquals(listOf("d1", "sncf-d1"), result.onLines(setOf("D")).stopTimes.map { it.tripId })
        assertEquals(listOf("d1", "a1", "ter"), result.distinctTrains().stopTimes.map { it.tripId })
        assertEquals(listOf("ter"), result.onLines(setOf("TER")).stopTimes.map { it.tripId })
    }

    @Test
    fun `keeps a train without number once when another feed numbers it`() {
        val result =
            page(
                st("fr", "06:12", "LONG_DISTANCE", "FR", "Trenitalia"),
                st("it", "06:12", "HIGHSPEED_RAIL", "FR 6147", "TRENITALIA", number = "6147"),
                st("bus", "06:12", "BUS", "24", "TRENITALIA"),
                st("other", "06:13", "LONG_DISTANCE", "FR", "Trenitalia"),
            )

        assertEquals(listOf("it", "bus", "other"), result.distinctTrains().stopTimes.map { it.tripId })
    }

    @Test
    fun `follows a page by the next or the previous one`() {
        val first = page(st("a1", "17:31", "REGIONAL_RAIL", "A"), previous = "EARLIER|1", next = "LATER|1")
        val next = page(st("a2", "17:50", "REGIONAL_RAIL", "A"), st("a1", "17:31", "REGIONAL_RAIL", "A"), previous = "EARLIER|2", next = "LATER|2")

        val later = first.followedBy(next, earlier = false)
        assertEquals(listOf("a1", "a2"), later.stopTimes.map { it.tripId })
        assertEquals("EARLIER|1", later.previousPageCursor)
        assertEquals("LATER|2", later.nextPageCursor)

        val earlier = first.followedBy(next, earlier = true)
        assertEquals("EARLIER|2", earlier.previousPageCursor)
        assertEquals("LATER|1", earlier.nextPageCursor)
    }
}
