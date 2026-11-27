package org.litote.motis.mcp.dto

import org.litote.motis.mcp.BoundingBox
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PolylineCodecTest {
    // example of the Google encoded polyline algorithm documentation
    private val encoded = "_p~iF~ps|U_ulLnnqC_mqNvxq`@"
    private val points = listOf(38.5 to -120.2, 40.7 to -120.95, 43.252 to -126.453)

    private fun assertClose(expected: List<Pair<Double, Double>>, actual: List<Pair<Double, Double>>) {
        assertEquals(expected.size, actual.size)
        expected.zip(actual).forEach { (e, a) ->
            assertTrue(abs(e.first - a.first) < 1e-6 && abs(e.second - a.second) < 1e-6, "$e != $a")
        }
    }

    @Test
    fun `decodes and encodes the reference polyline`() {
        assertClose(points, PolylineCodec.decode(encoded, 5))
        assertEquals(encoded, PolylineCodec.encode(points, 5))
    }

    @Test
    fun `round trips with precision 6`() {
        assertClose(points, PolylineCodec.decode(PolylineCodec.encode(points, 6), 6))
    }

    @Test
    fun `clip keeps the parts inside the box with one point outside at both ends`() {
        val line = listOf(0.0 to 0.0, 1.0 to 1.0, 2.0 to 2.0, 3.0 to 3.0, 4.0 to 4.0, 5.0 to 5.0, 2.0 to 2.5)
        val parts = PolylineCodec.clip(line, BoundingBox(1.5, 1.5, 3.5, 3.5))

        assertEquals(
            listOf(
                listOf(1.0 to 1.0, 2.0 to 2.0, 3.0 to 3.0, 4.0 to 4.0),
                listOf(5.0 to 5.0, 2.0 to 2.5),
            ),
            parts,
        )
    }

    @Test
    fun `simplify drops the points close to the line and keeps the ends and the corners`() {
        // about 1.1 m per 0.00001 degree of latitude: a straight line with a 1 m bump, then a 100 m corner
        val line = listOf(45.0 to 4.0, 45.001 to 4.00001, 45.002 to 4.0, 45.003 to 4.0, 45.003 to 4.0013, 45.003 to 4.002)

        assertEquals(listOf(45.0 to 4.0, 45.003 to 4.0, 45.003 to 4.002), PolylineCodec.simplify(line, 3.0))
        assertEquals(line.take(2), PolylineCodec.simplify(line.take(2), 3.0))
    }

    @Test
    fun `simplify keeps a long recorded path within the tolerance with much fewer points`() {
        val recorded = javaClass.getResource("/motis/rer-a-detour-polyline.txt")!!.readText().trim()
        val points = PolylineCodec.decode(recorded, 6)
        val simplified = Polyline(recorded).simplified()
        val kept = PolylineCodec.decode(simplified.points, 6)

        assertTrue(kept.size < points.size / 2, "${kept.size} of ${points.size}")
        assertEquals(points.first(), kept.first())
        assertEquals(points.last(), kept.last())
        // every point of the path is within the tolerance of the simplified line (and the rounding of the encoding)
        val farthest = points.maxOf { p -> kept.zipWithNext().minOf { (a, b) -> distanceMeters(p, a, b) } }
        assertTrue(farthest <= PolylineCodec.MAP_TOLERANCE_METERS + 0.2, "$farthest m")
    }

    /** Distance from [p] to the segment [a]-[b] in meters, on a local equirectangular projection. */
    private fun distanceMeters(p: Pair<Double, Double>, a: Pair<Double, Double>, b: Pair<Double, Double>): Double {
        val metersPerDegree = 6_371_000.0 * Math.PI / 180
        val cosLat = cos(Math.toRadians(p.first))
        fun x(c: Pair<Double, Double>) = c.second * cosLat * metersPerDegree
        fun y(c: Pair<Double, Double>) = c.first * metersPerDegree
        val dx = x(b) - x(a)
        val dy = y(b) - y(a)
        val length2 = dx * dx + dy * dy
        val t = if (length2 == 0.0) 0.0 else (((x(p) - x(a)) * dx + (y(p) - y(a)) * dy) / length2).coerceIn(0.0, 1.0)
        return hypot(x(p) - (x(a) + t * dx), y(p) - (y(a) + t * dy))
    }
}
