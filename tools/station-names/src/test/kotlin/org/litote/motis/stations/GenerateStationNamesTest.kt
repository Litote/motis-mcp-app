package org.litote.motis.stations

import kotlin.test.Test
import kotlin.test.assertEquals

class GenerateStationNamesTest {
    @Test
    fun `normalize removes the accents, the case and the punctuation`() {
        assertEquals("figueres vilafant", normalize("Figueres – Vilafant"))
        assertEquals("strasse", normalize("Straße"))
        assertEquals("gerone", normalize("Gérone"))
    }

    @Test
    fun `prefixes are the first 1 to 3 words and the first word before a hyphen`() {
        assertEquals(listOf("Vila-Real", "Vila"), prefixes("Vila-Real"))
        assertEquals(listOf("Barcelona", "Barcelona Sants"), prefixes("Barcelona Sants"))
        assertEquals(listOf("La", "La Ferté-Macé", "La Ferté-Macé Place"), prefixes("La Ferté-Macé Place Neustadt"))
    }

    @Test
    fun `the city part is translated, the rest keeps its punctuation`() {
        val (city, names) = localize(
            "Figueres – Vilafant",
            listOf(mapOf("ca" to "Figueres", "es" to "Figueras", "fr" to "Figueres")),
        )
        assertEquals("Figueres", city)
        assertEquals("Figueras – Vilafant", names["es"])
        assertEquals("Figueres – Vilafant", names["fr"])
        assertEquals("Figueres – Vilafant", names["en"])
    }

    @Test
    fun `the longest label wins and an area is never the city`() {
        val (city, names) = localize(
            "Barcelona Sants",
            listOf(
                mapOf("en" to "Barcelona metropolitan area", "fr" to "Barcelone"),
                mapOf("ca" to "Barcelona", "fr" to "Barcelone", "it" to "Barcellona"),
                mapOf("ca" to "Sants"),
            ),
        )
        assertEquals("Barcelona", city)
        assertEquals("Barcelone Sants", names["fr"])
        assertEquals("Barcellona Sants", names["it"])
    }

    @Test
    fun `the qualifier of the city is replaced by its translation`() {
        val (city, names) = localize(
            "Frankfurt (Main) Hbf",
            listOf(mapOf("en" to "Frankfurt", "de" to "Frankfurt am Main", "fr" to "Francfort-sur-le-Main")),
        )
        assertEquals("Frankfurt (Main)", city)
        assertEquals("Francfort-sur-le-Main Hbf", names["fr"])
        assertEquals("Frankfurt am Main Hbf", names["de"])
        // the label without the qualifier is not a translation
        assertEquals("Frankfurt (Main) Hbf", names["en"])
    }

    @Test
    fun `the label of a district named after the city is not a translation`() {
        val (_, names) = localize("Neustadt Bahnhof", listOf(mapOf("de" to "Neustadt", "fr" to "Hambourg-Neustadt")))
        assertEquals("Neustadt Bahnhof", names["fr"])
    }

    @Test
    fun `no city found`() {
        assertEquals("" to LANGUAGES_OF_TEST.associateWith { "El Arahal" }, localize("El Arahal", listOf(mapOf("es" to "Marchena"))))
    }

    private companion object {
        val LANGUAGES_OF_TEST = listOf("fr", "es", "en", "nl", "de", "it")
    }
}
