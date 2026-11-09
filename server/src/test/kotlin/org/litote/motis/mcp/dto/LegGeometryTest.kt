package org.litote.motis.mcp.dto

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class LegGeometryTest {
    private fun length(points: List<Pair<Double, Double>>) = points.zipWithNext { a, b -> distanceKm(a.first, a.second, b.first, b.second) }.sum()

    @Test
    fun `keeps a geometry passing by its stops`() {
        val points = listOf(48.80 to 2.30, 48.805 to 2.31, 48.81 to 2.32, 48.815 to 2.33, 48.82 to 2.34)
        assertNull(LegGeometry.repair(points, listOf(48.80 to 2.30, 48.81 to 2.32, 48.82 to 2.34)))
    }

    @Test
    fun `replaces a detour between two stops by a straight line`() {
        // second part goes 10 km north before reaching the last stop
        val points = listOf(48.80 to 2.30, 48.81 to 2.32, 48.90 to 2.33, 48.82 to 2.34)
        val repaired = assertNotNull(LegGeometry.repair(points, listOf(48.80 to 2.30, 48.81 to 2.32, 48.82 to 2.34)))
        assertEquals(listOf(48.80 to 2.30, 48.81 to 2.32, 48.82 to 2.34), repaired)
    }

    @Test
    fun `keeps a loop of a mountain railway`() {
        // 5 km between the stops, 12 km by the track (like the spirals of Bergün -> Preda)
        val points = listOf(48.0 to 2.0, 48.025 to 2.017, 48.05 to 2.0337, 48.025 to 2.05, 48.0 to 2.0674)
        assertTrue(length(points) > 2 * distanceKm(48.0, 2.0, 48.0, 2.0674))
        assertNull(LegGeometry.repair(points, listOf(48.0 to 2.0, 48.0 to 2.0674)))
    }

    @Test
    fun `repairs the RER A going around Paris by the north`() {
        // geometry of MOTIS (Transitous, November 2026) for a RER A from Gare de Lyon to La Défense
        val encoded = javaClass.getResource("/motis/rer-a-detour-polyline.txt")!!.readText().trim()
        val points = PolylineCodec.decode(encoded, 6)
        val stops =
            listOf(
                48.843403 to 2.376366, // Gare de Lyon
                48.861744 to 2.346977, // Châtelet - Les Halles
                48.872276 to 2.329646, // Auber
                48.874146 to 2.295169, // Charles de Gaulle - Étoile
                48.891560 to 2.238251, // La Défense
            )
        assertTrue(length(points) > 20)

        val repaired = assertNotNull(LegGeometry.repair(points, stops))

        assertTrue(length(repaired) < 14, "${length(repaired)} km")
        assertTrue(repaired.all { it.first < 48.895 }, "still goes north of La Défense")
    }
}
