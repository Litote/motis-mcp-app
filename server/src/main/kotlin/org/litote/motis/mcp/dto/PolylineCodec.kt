package org.litote.motis.mcp.dto

import org.litote.motis.mcp.BoundingBox
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.pow
import kotlin.math.roundToLong

/** Google encoded polyline format, as used by MOTIS (precision 5 or 6 decimals). */
object PolylineCodec {
    fun decode(points: String, precision: Int): List<Pair<Double, Double>> {
        val factor = 10.0.pow(precision)
        val result = mutableListOf<Pair<Double, Double>>()
        var index = 0
        var lat = 0L
        var lon = 0L
        fun next(): Long {
            var shift = 0
            var value = 0L
            var b: Int
            do {
                b = points[index++].code - 63
                value = value or ((b and 0x1f).toLong() shl shift)
                shift += 5
            } while (b >= 0x20)
            return if (value and 1L != 0L) (value shr 1).inv() else value shr 1
        }
        while (index < points.length) {
            lat += next()
            lon += next()
            result += lat / factor to lon / factor
        }
        return result
    }

    fun encode(coordinates: List<Pair<Double, Double>>, precision: Int): String {
        val factor = 10.0.pow(precision)
        val out = StringBuilder()
        var lastLat = 0L
        var lastLon = 0L
        fun write(delta: Long) {
            var value = if (delta < 0) (delta shl 1).inv() else delta shl 1
            while (value >= 0x20) {
                out.append(((0x20 or (value and 0x1f).toInt()) + 63).toChar())
                value = value shr 5
            }
            out.append((value.toInt() + 63).toChar())
        }
        for ((lat, lon) in coordinates) {
            val iLat = (lat * factor).roundToLong()
            val iLon = (lon * factor).roundToLong()
            write(iLat - lastLat)
            write(iLon - lastLon)
            lastLat = iLat
            lastLon = iLon
        }
        return out.toString()
    }

    /** Tolerance of the paths shown on a map: below a pixel up to zoom 15, the closest zoom of the views on a path. */
    const val MAP_TOLERANCE_METERS = 3.0

    /**
     * Douglas–Peucker simplification of [coordinates] (lat, lon): keeps the ends, and the points farther than
     * [toleranceMeters] from the simplified line. The distances are computed on a local equirectangular projection.
     */
    fun simplify(coordinates: List<Pair<Double, Double>>, toleranceMeters: Double): List<Pair<Double, Double>> {
        if (coordinates.size < 3) return coordinates
        val cosLat = cos(Math.toRadians(coordinates.first().first))
        val x = DoubleArray(coordinates.size) { Math.toRadians(coordinates[it].second) * cosLat * EARTH_RADIUS_METERS }
        val y = DoubleArray(coordinates.size) { Math.toRadians(coordinates[it].first) * EARTH_RADIUS_METERS }
        val keep = BooleanArray(coordinates.size)
        keep[0] = true
        keep[coordinates.lastIndex] = true
        // iterative: a long path would overflow the stack of a recursion
        val ranges = ArrayDeque<Pair<Int, Int>>().apply { add(0 to coordinates.lastIndex) }
        while (ranges.isNotEmpty()) {
            val (first, last) = ranges.removeLast()
            var farthest = -1
            var maxDistance = toleranceMeters
            for (i in first + 1 until last) {
                val d = segmentDistance(x[i], y[i], x[first], y[first], x[last], y[last])
                if (d > maxDistance) {
                    maxDistance = d
                    farthest = i
                }
            }
            if (farthest >= 0) {
                keep[farthest] = true
                ranges += first to farthest
                ranges += farthest to last
            }
        }
        return coordinates.filterIndexed { i, _ -> keep[i] }
    }

    private const val EARTH_RADIUS_METERS = 6_371_000.0

    /** Distance from (px, py) to the segment (ax, ay)-(bx, by). */
    private fun segmentDistance(px: Double, py: Double, ax: Double, ay: Double, bx: Double, by: Double): Double {
        val dx = bx - ax
        val dy = by - ay
        val length2 = dx * dx + dy * dy
        val t = if (length2 == 0.0) 0.0 else (((px - ax) * dx + (py - ay) * dy) / length2).coerceIn(0.0, 1.0)
        return hypot(px - (ax + t * dx), py - (ay + t * dy))
    }

    /**
     * Parts of the polyline inside [bbox]. Each part keeps the first point outside at both ends,
     * so that the lines reach the edge of the area.
     */
    fun clip(coordinates: List<Pair<Double, Double>>, bbox: BoundingBox): List<List<Pair<Double, Double>>> {
        fun inside(p: Pair<Double, Double>) = p.first in bbox.minLat..bbox.maxLat && p.second in bbox.minLon..bbox.maxLon
        val parts = mutableListOf<List<Pair<Double, Double>>>()
        var current = mutableListOf<Pair<Double, Double>>()
        coordinates.forEachIndexed { i, p ->
            if (inside(p)) {
                if (current.isEmpty() && i > 0) current += coordinates[i - 1]
                current += p
            } else if (current.isNotEmpty()) {
                current += p
                parts += current
                current = mutableListOf()
            }
        }
        if (current.size > 1) parts += current
        return parts
    }
}
