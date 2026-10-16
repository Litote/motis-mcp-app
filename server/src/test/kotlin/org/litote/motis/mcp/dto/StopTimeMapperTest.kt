package org.litote.motis.mcp.dto

import kotlinx.serialization.json.Json
import org.litote.motis.client.client.TimetableClient
import kotlin.test.Test
import kotlin.test.assertEquals

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
}
