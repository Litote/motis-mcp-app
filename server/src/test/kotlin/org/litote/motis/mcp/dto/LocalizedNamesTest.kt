package org.litote.motis.mcp.dto

import kotlin.test.Test
import kotlin.test.assertEquals

class LocalizedNamesTest {
    private val names =
        LocalizedNames(
            "fr",
            StationNames(
                listOf(
                    "8777500\t43.83229\t4.36585\t1\tNîmes Centre\tNîmes\t\tNimes Centre\t\t\t\t",
                    "7179300\t41.97952\t2.81648\t0\tGirona\tGirona\tGérone\tGerona\t\t\t\tGerona",
                ).joinToString("\n"),
            ),
        )

    private fun stop(name: String, lat: Double, lon: Double) = PlaceDto(name, lat, lon, stopId = "avs_1")

    @Test
    fun `the stops and the headsigns of the departures are renamed`() {
        val result =
            DeparturesResult(
                stop = stop("Nimes", 43.8323, 4.3659),
                arriveBy = false,
                stopTimes =
                    listOf(
                        StopTimeDto(
                            time = null, scheduledTime = null, realTime = false, cancelled = false, mode = "HIGHSPEED_RAIL", line = "AVE INT",
                            headsign = "Girona", agency = "Renfe", tripId = "t", stops = listOf(StopCallDto("Nimes"), StopCallDto("Girona", "2026-11-12T16:00:00Z")),
                        ),
                    ),
            )
        val localized = names.departures(result)
        assertEquals("Nîmes Centre", localized.stop.name)
        assertEquals("Gérone", localized.stopTimes.single().headsign)
        assertEquals(listOf("Nîmes Centre", "Gérone"), localized.stopTimes.single().stops!!.map { it.name })
    }

    @Test
    fun `the coordinates and the addresses asked by the user are kept`() {
        val place = PlaceDto("Girona", 41.9795, 2.8165, stopId = null)
        assertEquals(place, names.place(place))
    }

    @Test
    fun `a result is not renamed without a language of stations`() {
        assertEquals(null, LocalizedNames.of(null))
        assertEquals(null, LocalizedNames.of(listOf("pt")))
    }
}
