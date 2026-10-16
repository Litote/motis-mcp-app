package org.litote.motis.mcp.dto

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertSame
import kotlin.time.Instant

class NearbyTrainsTest {
    private fun at(hhmm: String) = "2026-10-16T$hhmm:00Z"

    private fun epoch(hhmm: String) = Instant.parse(at(hhmm)).epochSeconds

    private fun st(tripId: String, hhmm: String, mode: String = "REGIONAL_RAIL", number: String? = null, headsign: String = "Juvisy") =
        StopTimeDto(at(hhmm), at(hhmm), false, false, mode, "C", headsign, agency = "RER", tripId = tripId, trainNumber = number)

    private fun page(vararg stopTimes: StopTimeDto) =
        DeparturesResult(
            stop = PlaceDto("Gare de Lyon", 48.8, 2.3, "IDFM:73626"),
            arriveBy = false,
            stopTimes = stopTimes.toList(),
            nextPageCursor = "LATER|0",
            previousPageCursor = "EARLIER|0",
        )

    private fun DeparturesResult.trips() = stopTimes.map { it.tripId }

    @Test
    fun `adds the trains of the other stops of the station, until the end of the shorter full page`() {
        val idfm = page(st("rer1", "17:25"), st("rer2", "17:40"), st("metro", "17:41", "SUBWAY"))
        // the same RER, then the TGV of the SNCF stop
        val sncf = page(st("rer1", "17:25"), st("tgv1", "17:30", "HIGHSPEED_RAIL", "6603"), st("tgv2", "17:35", "HIGHSPEED_RAIL", "6605"))

        val merged = idfm.withNearbyTrains(sncf, n = 3, earlier = false)

        // the trains after 17:35 may be missing from the SNCF page: rer2 and the metro are on the next one
        assertEquals(listOf("rer1", "tgv1", "tgv2"), merged.trips())
        assertEquals("LATER|${epoch("17:36")}", merged.nextPageCursor)
        assertEquals("EARLIER|${epoch("17:24")}", merged.previousPageCursor)
    }

    @Test
    fun `keeps a page of n stop times, without splitting a minute`() {
        val idfm = page(st("rer1", "17:25"), st("rer2", "17:30"), st("rer3", "17:30"), st("rer4", "17:45"))
        val sncf = page(st("tgv1", "17:26", "HIGHSPEED_RAIL", "6603"), st("tgv2", "17:50", "HIGHSPEED_RAIL", "6605"))

        val merged = idfm.withNearbyTrains(sncf, n = 3, earlier = false)

        // rer3 at 17:30 would be the 4th: the page stops before 17:30, the next one starts at 17:30
        assertEquals(listOf("rer1", "tgv1"), merged.trips())
        assertEquals("LATER|${epoch("17:30")}", merged.nextPageCursor)
    }

    @Test
    fun `removes the trains of two feeds with the same number and scheduled time`() {
        val sncf = page(st("sncf-ter", "17:37", number = "847447"), st("sncf-c17", "17:40", headsign = "847449"))
        val idfm = page(st("idfm-ter", "17:37", number = "847447"), st("idfm-c17", "17:40", number = "847449"), st("rer", "17:41"))

        val merged = sncf.withNearbyTrains(idfm, n = 5, earlier = false)

        assertEquals(listOf("sncf-ter", "sncf-c17", "rer"), merged.trips())
    }

    @Test
    fun `is the page itself without other trains`() {
        val idfm = page(st("rer1", "17:25"))

        assertSame(idfm, idfm.withNearbyTrains(page(st("rer1", "17:25")), n = 3, earlier = false))
    }

    @Test
    fun `keeps the latest stop times of a previous page`() {
        val idfm = page(st("rer1", "17:00"), st("rer2", "17:20"), st("rer3", "17:25"))
        val sncf = page(st("tgv1", "17:10", "HIGHSPEED_RAIL", "6603"), st("tgv2", "17:15", "HIGHSPEED_RAIL", "6605"), st("tgv3", "17:20", "HIGHSPEED_RAIL", "6607"))

        val merged = idfm.withNearbyTrains(sncf, n = 3, earlier = true)

        // the stop times before 17:10 may be missing from the SNCF page, then the 3 latest ones
        assertEquals(listOf("rer2", "tgv3", "rer3"), merged.trips())
        assertEquals("EARLIER|${epoch("17:15")}", merged.previousPageCursor)
        assertEquals("LATER|${epoch("17:26")}", merged.nextPageCursor)
    }
}
