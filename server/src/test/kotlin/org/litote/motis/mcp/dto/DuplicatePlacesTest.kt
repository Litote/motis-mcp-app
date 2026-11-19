package org.litote.motis.mcp.dto

import org.litote.motis.client.model.LocationType
import org.litote.motis.client.model.Match
import kotlin.test.Test
import kotlin.test.assertEquals

class DuplicatePlacesTest {
    private fun match(id: String, name: String, lat: Double, lon: Double, type: LocationType = LocationType.PLACE, category: String? = "guidepost") =
        Match(areas = emptyList(), category = category, id = id, lat = lat, lon = lon, name = name, score = 1.0, tokens = emptyList(), type = type)

    @Test
    fun `the places of the same name and category close to a better one are dropped`() {
        val matches =
            listOf(
                match("node/1", "Gare de Grenoble", 45.1902455, 5.7149268),
                match("node/2", "Gare de Grenoble", 45.1897742, 5.7155743),
                match("node/3", "Gare de Grenoble", 45.1900013, 5.7150089),
            )

        assertEquals(listOf("node/1"), matches.withoutDuplicatePlaces().map { it.id })
    }

    @Test
    fun `the stops, the places far apart or of another category or name are kept`() {
        val matches =
            listOf(
                match("node/1", "Billets Grandes Lignes", 45.7606151, 4.8597686),
                match("node/2", "Billets Régionaux", 45.7606422, 4.8597693),
                match("node/3", "Billets Grandes Lignes", 45.7606293, 4.8597689, category = "ticket_office"),
                match("node/4", "Billets Grandes Lignes", 45.77, 4.8597686),
                match("stop/1", "Gare", 45.19, 5.71, type = LocationType.STOP, category = null),
                match("stop/2", "Gare", 45.19, 5.71, type = LocationType.STOP, category = null),
            )

        assertEquals(matches.map { it.id }, matches.withoutDuplicatePlaces().map { it.id })
    }
}
