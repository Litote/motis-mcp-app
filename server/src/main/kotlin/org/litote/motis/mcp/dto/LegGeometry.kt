package org.litote.motis.mcp.dto

import org.litote.motis.client.client.RoutingClient
import org.litote.motis.client.model.Itinerary
import org.litote.motis.client.model.Leg

/**
 * Part of the shape of a transit leg replaced by a straight line (see [LegGeometry]): the part from the stop [from] to
 * the stop [to] of the line [line] ([routeId]) was [drawnKm] long for [directKm] between the stops, [offStop] when it did
 * not pass near one of them. The trip is left out: logged, it would tell the time of a journey searched.
 */
data class ShapeRepair(
    val line: String?,
    val routeId: String?,
    val from: String,
    val to: String,
    val drawnKm: Double,
    val directKm: Double,
    val offStop: Boolean,
)

/** Journeys with the shapes of their transit legs repaired, see [LegGeometry]: [report] receives each repaired part. */
fun RoutingClient.PlanResponseBody.withRepairedShapes(report: (ShapeRepair) -> Unit = {}): RoutingClient.PlanResponseBody =
    copy(itineraries = itineraries.map { it.withRepairedShapes(report) })

/** Itinerary with the shapes of its transit legs repaired, see [LegGeometry]: [report] receives each repaired part. */
fun Itinerary.withRepairedShapes(report: (ShapeRepair) -> Unit = {}): Itinerary = copy(legs = legs.map { it.withRepairedShape(report) })

/**
 * Transit leg with its shape repaired, see [LegGeometry]: the other legs (walk, bike...) are kept as is. [report]
 * receives each repaired part.
 */
fun Leg.withRepairedShape(report: (ShapeRepair) -> Unit = {}): Leg {
    if (tripId == null) return this
    val precision = legGeometry.precision.toInt()
    val stops = listOf(from) + intermediateStops.orEmpty() + to
    val repair = LegGeometry.repair(PolylineCodec.decode(legGeometry.points, precision), stops.map { it.lat to it.lon }) ?: return this
    val line = listOf(displayName, routeShortName).firstOrNull { !it.isNullOrBlank() }
    repair.parts.forEach {
        report(ShapeRepair(line, routeId, stops[it.from].name, stops[it.to].name, it.drawnKm, it.directKm, it.offStop))
    }
    return copy(
        legGeometry = legGeometry.copy(points = PolylineCodec.encode(repair.points, precision), length = repair.points.size.toLong()),
    )
}

/**
 * Repairs the shape of a transit leg: the shapes of the feeds (`shapes.txt`) or matched by MOTIS on the OpenStreetMap
 * rails are sometimes wrong, e.g. the RER A from Gare de Lyon to La Défense drawn via Saint-Denis (25 km for 12 km) in
 * the IDFM feed of November 2026.
 *
 * The geometry is cut at the stops of the leg (its ends and intermediate stops, in order): a part between two stops
 * is replaced by a straight line between them when it does not pass near them or is much longer than their distance.
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

    /** Part replaced between the stops of indexes [from] and [to], see [ShapeRepair]. */
    data class Part(val from: Int, val to: Int, val drawnKm: Double, val directKm: Double, val offStop: Boolean)

    /** Repaired geometry: its [points], and the [parts] replaced. */
    class Repair(val points: List<Pair<Double, Double>>, val parts: List<Part>)

    /** Repair of the geometry of the [points] serving the [stops], null when the geometry is kept as is. */
    fun repair(points: List<Pair<Double, Double>>, stops: List<Pair<Double, Double>>): Repair? {
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
        val parts = mutableListOf<Part>()
        val result = mutableListOf<Pair<Double, Double>>()
        for (s in 0 until stops.lastIndex) {
            val part = points.subList(indexes[s], indexes[s + 1] + 1)
            val direct = distance(stops[s], stops[s + 1])
            val drawn = length(part)
            val offStop = far[s] || far[s + 1]
            val bad = offStop || drawn > direct * DETOUR_RATIO + DETOUR_SLACK_KM
            if (bad) parts += Part(s, s + 1, drawn, direct, offStop)
            val segment = if (bad) listOf(stops[s], stops[s + 1]) else part
            // the first point of a part is the last one of the previous part
            result += if (result.isEmpty()) segment else segment.drop(1)
        }
        if (parts.isEmpty()) return null
        // keeps the walk from/to the platform drawn before the first and after the last stop
        return Repair(points.subList(0, indexes.first()) + result + points.subList(indexes.last() + 1, points.size), parts)
    }

    private fun distance(a: Pair<Double, Double>, b: Pair<Double, Double>) = distanceKm(a.first, a.second, b.first, b.second)

    private fun length(points: List<Pair<Double, Double>>) = points.zipWithNext { a, b -> distance(a, b) }.sum()
}
