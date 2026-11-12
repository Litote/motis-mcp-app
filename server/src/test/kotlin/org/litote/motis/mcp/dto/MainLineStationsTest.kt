package org.litote.motis.mcp.dto

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertSame
import kotlin.test.assertTrue

class MainLineStationsTest {
    private val paris = Coordinates(48.853, 2.348)
    private val nantesCenter = Coordinates(47.218, -1.554)

    private fun place(name: String, lat: Double, lon: Double, stopId: String? = null) = PlaceDto(name, lat, lon, stopId)

    private fun leg(mode: String, from: PlaceDto, to: PlaceDto, start: String, end: String, tripId: String? = null) =
        LegDto(mode, from, to, start, end, start, end, 60, realTime = false, tripId = tripId, polyline = Polyline(""))

    private val center = place("START", paris.lat, paris.lon)
    private val cite = place("Cité", 48.855, 2.347, "m4-cite")
    private val saintMichel = place("Saint-Michel", 48.853, 2.344, "m4-stmichel")
    private val metroMontparnasse = place("Gare Montparnasse", 48.843, 2.322, "m4-montparnasse")
    private val montparnasse = place("Paris Montparnasse", 48.841, 2.320, "montparnasse")
    private val leMans = place("Le Mans", 47.995, 0.192, "le-mans")
    private val nantes = place("Nantes", 47.217, -1.542, "nantes")
    private val busStop = place("Sophie Trébuchet", 47.219, -1.550, "bus-1")
    private val end = place("END", nantesCenter.lat, nantesCenter.lon)

    /** Center of Paris, metro, TGV, bus, center of Nantes. */
    private fun throughMontparnasse(metroFrom: PlaceDto, start: String) =
        ItineraryDto(
            start,
            "2026-11-04T08:06:00Z",
            9000,
            2,
            listOf(
                leg("WALK", center, metroFrom, start, "2026-11-04T05:35:00Z"),
                leg("SUBWAY", metroFrom, metroMontparnasse, "2026-11-04T05:35:00Z", "2026-11-04T05:50:00Z", "m4"),
                leg("WALK", metroMontparnasse, montparnasse, "2026-11-04T05:50:00Z", "2026-11-04T06:00:00Z"),
                leg("HIGHSPEED_RAIL", montparnasse, nantes, "2026-11-04T06:00:00Z", "2026-11-04T08:00:00Z", "tgv-1"),
                leg("BUS", nantes, busStop, "2026-11-04T08:00:00Z", "2026-11-04T08:04:00Z", "bus-11"),
                leg("WALK", busStop, end, "2026-11-04T08:04:00Z", "2026-11-04T08:06:00Z"),
            ),
        )

    /** TGV to Le Mans, then a regional train to Nantes. */
    private val throughLeMans =
        ItineraryDto(
            "2026-11-04T08:40:00Z",
            "2026-11-04T11:10:00Z",
            9000,
            2,
            listOf(
                leg("WALK", center, cite, "2026-11-04T08:40:00Z", "2026-11-04T08:45:00Z"),
                leg("SUBWAY", cite, metroMontparnasse, "2026-11-04T08:45:00Z", "2026-11-04T08:55:00Z", "m4-c"),
                leg("HIGHSPEED_RAIL", montparnasse, leMans, "2026-11-04T09:00:00Z", "2026-11-04T10:00:00Z", "tgv-2"),
                leg("REGIONAL_RAIL", leMans, nantes, "2026-11-04T10:05:00Z", "2026-11-04T11:00:00Z", "ter-1"),
                leg("WALK", nantes, end, "2026-11-04T11:00:00Z", "2026-11-04T11:10:00Z"),
            ),
        )

    private val local =
        ItineraryDto(
            "2026-11-04T07:00:00Z",
            "2026-11-04T07:30:00Z",
            1800,
            0,
            listOf(
                leg("WALK", center, cite, "2026-11-04T07:00:00Z", "2026-11-04T07:05:00Z"),
                leg("SUBWAY", cite, metroMontparnasse, "2026-11-04T07:05:00Z", "2026-11-04T07:25:00Z", "m4-b"),
                leg("WALK", metroMontparnasse, end, "2026-11-04T07:25:00Z", "2026-11-04T07:30:00Z"),
            ),
        )

    private fun journey(vararg itineraries: ItineraryDto) =
        JourneyResult(from = center, to = end, itineraries = itineraries.toList(), direct = emptyList())

    @Test
    fun `journeys between cities go from station to station`() {
        val trimmed = journey(throughMontparnasse(cite, "2026-11-04T05:30:00Z")).fromMainLineStations(paris, nantesCenter)

        val itinerary = trimmed.itineraries.single()
        assertEquals(listOf("HIGHSPEED_RAIL"), itinerary.legs.map { it.mode })
        assertEquals("2026-11-04T06:00:00Z", itinerary.startTime)
        assertEquals("2026-11-04T08:00:00Z", itinerary.endTime)
        assertEquals(7200, itinerary.durationSeconds)
        assertEquals(0, itinerary.transfers)
    }

    @Test
    fun `the trains to the city after the last long-distance train are kept`() {
        val itinerary = journey(throughLeMans).fromMainLineStations(paris, nantesCenter).itineraries.single()

        // not cut at Le Mans, 180 km from Nantes
        assertEquals(listOf("HIGHSPEED_RAIL", "REGIONAL_RAIL"), itinerary.legs.map { it.mode })
        assertEquals("2026-11-04T11:00:00Z", itinerary.endTime)
        assertEquals(1, itinerary.transfers)
    }

    @Test
    fun `the outer stations of a city are stations of the city`() {
        val chatelet = place("Châtelet - Les Halles", 48.861, 2.347, "rer-chatelet")
        val chessyRer = place("Marne-la-Vallée - Chessy", 48.8698, 2.7825, "rer-chessy")
        val chessy = place("Marne-la-Vallée - Chessy", 48.8704, 2.7828, "chessy")
        val throughChessy =
            ItineraryDto(
                "2026-11-04T06:00:00Z",
                "2026-11-04T09:00:00Z",
                10800,
                1,
                listOf(
                    leg("WALK", center, chatelet, "2026-11-04T06:00:00Z", "2026-11-04T06:05:00Z"),
                    leg("SUBURBAN", chatelet, chessyRer, "2026-11-04T06:05:00Z", "2026-11-04T06:45:00Z", "rer-a"),
                    leg("WALK", chessyRer, chessy, "2026-11-04T06:45:00Z", "2026-11-04T06:50:00Z"),
                    leg("HIGHSPEED_RAIL", chessy, nantes, "2026-11-04T07:00:00Z", "2026-11-04T09:00:00Z", "tgv-3"),
                ),
            )

        // Paris: from Chessy (32 km)
        val fromParis = journey(throughChessy).fromMainLineStations(paris, nantesCenter)
        assertEquals(listOf("HIGHSPEED_RAIL"), fromParis.itineraries.single().legs.map { it.mode })
        assertEquals(listOf("chessy") to listOf("nantes"), fromParis.cityStations(paris, nantesCenter))

        // another city more than 25 km from Chessy (Melun): not its station
        val melun = Coordinates(48.540, 2.655)
        assertEquals(throughChessy, journey(throughChessy).fromMainLineStations(melun, nantesCenter).itineraries.single())
    }

    @Test
    fun `only the end asked as a city is cut`() {
        val fromCity = journey(throughMontparnasse(cite, "2026-11-04T05:30:00Z")).fromMainLineStations(paris, null)
        val itinerary = fromCity.itineraries.single()
        assertEquals(listOf("HIGHSPEED_RAIL", "BUS", "WALK"), itinerary.legs.map { it.mode })
        assertEquals("2026-11-04T06:00:00Z", itinerary.startTime)
        assertEquals("2026-11-04T08:06:00Z", itinerary.endTime)
        assertEquals(1, itinerary.transfers)

        val toCity = journey(throughMontparnasse(cite, "2026-11-04T05:30:00Z")).fromMainLineStations(null, nantesCenter)
        assertEquals(listOf("WALK", "SUBWAY", "WALK", "HIGHSPEED_RAIL"), toCity.itineraries.single().legs.map { it.mode })
    }

    @Test
    fun `itineraries made the same by the cut are merged`() {
        val trimmed =
            journey(
                throughMontparnasse(cite, "2026-11-04T05:30:00Z"),
                throughMontparnasse(saintMichel, "2026-11-04T05:25:00Z"),
            ).fromMainLineStations(paris, nantesCenter)

        assertEquals(1, trimmed.itineraries.size)
    }

    @Test
    fun `itineraries taking the trains of another one and more are left out`() {
        val massy = place("Massy TGV", 48.726, 2.261, "massy")
        val direct = leg("HIGHSPEED_RAIL", montparnasse, nantes, "2026-11-04T09:52:00Z", "2026-11-04T11:54:00Z", "tgv-8805")
        val directItinerary = ItineraryDto(direct.startTime, direct.endTime, 7320, 0, listOf(direct))
        val throughMassy =
            ItineraryDto(
                "2026-11-04T08:51:00Z",
                direct.endTime,
                10980,
                1,
                listOf(
                    leg("HIGHSPEED_RAIL", massy, montparnasse, "2026-11-04T08:51:00Z", "2026-11-04T09:00:00Z", "tgv-8404"),
                    leg("WALK", montparnasse, montparnasse, "2026-11-04T09:00:00Z", "2026-11-04T09:02:00Z"),
                    direct,
                ),
            )

        assertEquals(listOf(directItinerary), listOf(throughMassy, directItinerary).merged())
        // without the direct train, the one through Massy is kept
        assertEquals(listOf(throughMassy), listOf(throughMassy).merged())
    }

    @Test
    fun `itineraries without long-distance train are kept as is`() {
        val trimmed = journey(local).fromMainLineStations(paris, nantesCenter)

        assertEquals(listOf(local), trimmed.itineraries)
        assertFalse(trimmed.hasMainLineLegs())
    }

    @Test
    fun `journeys between places that are not cities are kept as is`() {
        val journey = journey(throughMontparnasse(cite, "2026-11-04T05:30:00Z"), local)

        assertSame(journey, journey.fromMainLineStations(null, null))
        assertTrue(journey.hasMainLineLegs())
    }

    @Test
    fun `the stations of the cities are those of the cut itineraries, most used first`() {
        val trimmed =
            journey(
                throughMontparnasse(cite, "2026-11-04T05:30:00Z"),
                throughLeMans,
                local,
            ).fromMainLineStations(paris, nantesCenter)

        assertEquals(listOf("montparnasse") to listOf("nantes"), trimmed.cityStations(paris, nantesCenter))
        // not cut: no station
        assertEquals(emptyList<String>() to emptyList(), journey(local).cityStations(paris, nantesCenter))
    }
}
