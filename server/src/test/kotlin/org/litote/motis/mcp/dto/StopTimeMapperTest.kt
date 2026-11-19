package org.litote.motis.mcp.dto

import kotlinx.serialization.json.Json
import org.litote.motis.client.client.RoutingClient
import org.litote.motis.client.client.TimetableClient
import org.litote.motis.client.model.Mode
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.time.Duration.Companion.minutes
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

        assertEquals(listOf(StopCallDto("Paris Gare de Lyon", "2026-10-12T19:00:00Z", "2026-10-12T19:00:00Z")), arrival.stops)
        assertEquals(listOf(StopCallDto("Lyon Perrache", "2026-10-12T21:30:00Z", "2026-10-12T21:30:00Z")), departure.stops)
        assertNull(stopTime.copy(nextStops = null).toDto(arriveBy = false).stops)
    }

    @Test
    fun `a train does not leave before its scheduled time, a bus may`() {
        val scheduled = Instant.parse("2026-11-19T07:50:00Z")
        val early = Instant.parse("2026-11-19T07:38:00Z")
        val place = stopTime.place.copy(scheduledDeparture = scheduled, departure = early)
        val next = stopTime.place.copy(scheduledArrival = Instant.parse("2026-11-19T09:46:00Z"), arrival = Instant.parse("2026-11-19T09:40:00Z"))
        val train = stopTime.copy(mode = Mode.HIGHSPEED_RAIL, place = place, nextStops = listOf(next), realTime = true)

        val dto = train.toDto(arriveBy = false)
        assertEquals("2026-11-19T07:50:00Z", dto.time)
        // an early arrival is possible
        assertEquals(listOf("2026-11-19T09:40:00Z"), dto.stops?.map { it.time })
        assertEquals("2026-11-19T07:38:00Z", train.copy(mode = Mode.BUS).toDto(arriveBy = false).time)
    }

    @Test
    fun `a train leg does not start before its scheduled time, nor leave its stops early`() {
        val leg =
            Json { ignoreUnknownKeys = true }
                .decodeFromString<RoutingClient.PlanResponseBody>(javaClass.getResource("/motis/plan.json")!!.readText())
                .itineraries
                .flatMap { it.legs }
                .first { it.tripId != null }
        val scheduled = leg.scheduledStartTime
        val early = leg.copy(mode = Mode.HIGHSPEED_RAIL, startTime = scheduled - 5.minutes, from = leg.from.copy(scheduledDeparture = scheduled, departure = scheduled - 5.minutes))

        val dto = early.toDto()
        assertEquals(scheduled.toString() to scheduled.toString(), dto.startTime to dto.from.departure)
        assertEquals((leg.endTime - scheduled).inWholeSeconds, dto.durationSeconds)
        assertEquals((scheduled - 5.minutes).toString(), early.copy(mode = Mode.BUS).toDto().startTime)
    }

    @Test
    fun `a train stop named Gare SNCF by its feed takes the name of its station, a bus stop keeps it`() {
        val sorgues = stopTime.place.copy(name = "Gare SNCF", lat = 44.0054, lon = 4.8756)
        val train = stopTime.copy(mode = Mode.REGIONAL_RAIL, nextStops = listOf(sorgues))

        assertEquals(listOf("Sorgues – Châteauneuf-du-Pape"), train.toDto(arriveBy = false).stops?.map { it.name })
        assertEquals(listOf("Gare SNCF"), train.copy(mode = Mode.BUS).toDto(arriveBy = false).stops?.map { it.name })
        assertEquals("Sorgues – Châteauneuf-du-Pape", sorgues.toDto(train = true).name)
    }
}
