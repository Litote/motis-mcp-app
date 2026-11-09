package org.litote.motis.mcp.dto

/**
 * Repairs the shape of a transit leg computed by MOTIS: without shapes in the GTFS, MOTIS matches the trips on the
 * OpenStreetMap rails, and the matching sometimes misses a track (e.g. the central tunnel of the RER A in Paris) and
 * takes a long detour (Gare de Lyon -> La Défense drawn via Saint-Denis, 25 km for 12 km).
 *
 * The geometry is cut at the [stops] of the leg (its ends and intermediate stops, in order): a part between two stops
 * is replaced by a straight line between them when it does not pass near them or is much longer than their distance.
 * Returns null when the geometry is kept as is.
 */
internal object LegGeometry {
    /** A stop farther than this from the geometry is not served by it. */
    private const val MAX_STOP_DISTANCE_KM = 0.5

    /**
     * A part is a detour when longer than [DETOUR_RATIO] times the distance of its stops plus [DETOUR_SLACK_KM]: high
     * enough to keep the real loops of mountain railways (e.g. Bergün -> Preda, about 2.5 times the distance).
     */
    private const val DETOUR_RATIO = 3.0
    private const val DETOUR_SLACK_KM = 1.5

    fun repair(points: List<Pair<Double, Double>>, stops: List<Pair<Double, Double>>): List<Pair<Double, Double>>? {
        if (points.size < 2 || stops.size < 2) return null
        // index of the closest point of each stop, in the order of the stops
        val indexes = IntArray(stops.size)
        val far = BooleanArray(stops.size)
        var start = 0
        stops.forEachIndexed { s, stop ->
            var bestDistance = Double.MAX_VALUE
            for (i in start..points.lastIndex) {
                val d = distance(points[i], stop)
                if (d < bestDistance) {
                    bestDistance = d
                    indexes[s] = i
                }
            }
            far[s] = bestDistance > MAX_STOP_DISTANCE_KM
            start = indexes[s]
        }
        var repaired = false
        val result = mutableListOf<Pair<Double, Double>>()
        for (s in 0 until stops.lastIndex) {
            val part = points.subList(indexes[s], indexes[s + 1] + 1)
            val direct = distance(stops[s], stops[s + 1])
            val bad = far[s] || far[s + 1] || length(part) > direct * DETOUR_RATIO + DETOUR_SLACK_KM
            val segment = if (bad) listOf(stops[s], stops[s + 1]) else part
            repaired = repaired || bad
            // the first point of a part is the last one of the previous part
            result += if (result.isEmpty()) segment else segment.drop(1)
        }
        if (!repaired) return null
        // keeps the walk from/to the platform drawn before the first and after the last stop
        return points.subList(0, indexes.first()) + result + points.subList(indexes.last() + 1, points.size)
    }

    private fun distance(a: Pair<Double, Double>, b: Pair<Double, Double>) = distanceKm(a.first, a.second, b.first, b.second)

    private fun length(points: List<Pair<Double, Double>>) = points.zipWithNext { a, b -> distance(a, b) }.sum()
}
