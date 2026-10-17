package org.litote.motis.mcp.dto

import kotlinx.serialization.json.Json
import org.litote.motis.client.client.TimetableClient
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.time.Instant

class StopTimeMapperTest {
    private val stopTime =
        Json { ignoreUnknownKeys = true }
            .decodeFromString<TimetableClient.StoptimesResponseBody>(
                StopTimeMapperTest::class.java.getResource("/motis/stoptimes.json")!!.readText(),
            ).stopTimes
            .first()

    @Test
    fun `the train number is the trip short name`() {
        val dto = stopTime.copy(tripShortName = "6633", headsign = "").toDto(arriveBy = false)

        assertEquals("6633", dto.trainNumber)
        assertEquals("Lyon Perrache", dto.headsign)
    }

    @Test
    fun `the train number of the SNCF regional trains of some feeds is their headsign`() {
        val dto = stopTime.copy(tripShortName = "", headsign = "847459").toDto(arriveBy = false)

        assertEquals("847459", dto.trainNumber)
        assertEquals("Lyon Perrache", dto.headsign)
    }

    @Test
    fun `destinations and next stops in capitals get the mixed case`() {
        val dto =
            stopTime
                .copy(
                    headsign = "LYON PERRACHE",
                    nextStops = listOf(stopTime.place.copy(name = "MILANO PORTA GARIBALDI"), stopTime.place.copy(name = "LYON PERRACHE")),
                ).toDto(arriveBy = false)

        assertEquals("Lyon Perrache", dto.headsign)
        assertEquals(listOf("Milano Porta Garibaldi", "Lyon Perrache"), dto.stops?.map { it.name })
    }

    @Test
    fun `the stops of an arrival are the previous ones, at their scheduled time without real time`() {
        val previous = stopTime.place.copy(name = "PARIS GARE DE LYON", departure = null, scheduledDeparture = Instant.parse("2026-10-12T19:00:00Z"))
        val next = stopTime.place.copy(name = "Lyon Perrache", arrival = null, scheduledArrival = Instant.parse("2026-10-12T21:30:00Z"))

        val arrival = stopTime.copy(previousStops = listOf(previous), nextStops = listOf(next)).toDto(arriveBy = true)
        val departure = stopTime.copy(previousStops = listOf(previous), nextStops = listOf(next)).toDto(arriveBy = false)

        assertEquals(listOf(StopCallDto("Paris Gare de Lyon", "2026-10-12T19:00:00Z")), arrival.stops)
        assertEquals(listOf(StopCallDto("Lyon Perrache", "2026-10-12T21:30:00Z")), departure.stops)
        assertNull(stopTime.copy(nextStops = null).toDto(arriveBy = false).stops)
    }
}
