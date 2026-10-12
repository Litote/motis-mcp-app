package org.litote.motis.mcp.dto

import org.litote.motis.mcp.BoundingBox
import kotlin.math.abs
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
}
