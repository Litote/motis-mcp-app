package org.litote.motis.mcp.dto

import org.litote.motis.mcp.BoundingBox
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
