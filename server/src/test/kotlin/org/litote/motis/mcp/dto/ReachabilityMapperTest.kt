package org.litote.motis.mcp.dto

import kotlinx.serialization.json.Json
import org.litote.motis.client.model.Reachable
import kotlin.test.Test
import kotlin.test.assertEquals

class ReachabilityMapperTest {
    private val reachable =
        Json { ignoreUnknownKeys = true }
            .decodeFromString<Reachable>(ReachabilityMapperTest::class.java.getResource("/motis/onetoall.json")!!.readText())

    @Test
    fun `stop names in capitals get the mixed case, places without stop keep their name`() {
        val stop = reachable.all!!.first()
        val stops =
            listOf(
                stop.copy(place = stop.place!!.copy(name = "LYON PERRACHE")),
                stop.copy(place = stop.place!!.copy(name = "END", stopId = null)),
            )

        val result = reachable.copy(all = stops).toDto(PlaceDto(name = "origin", lat = 0.0, lon = 0.0), 30)

        assertEquals(listOf("Lyon Perrache", "END"), result.places.map { it.name })
    }
}
