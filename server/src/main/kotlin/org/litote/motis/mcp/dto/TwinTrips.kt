package org.litote.motis.mcp.dto

import kotlin.time.Duration
import kotlin.time.Instant

/**
 * This trip with the real time of [twin], the same train in another feed (the `realTimeTripId` of its departure, see
 * [distinctTrains]), when the trip has none: the Trenitalia trains in France have their real time in the French feed
 * only. The stops are matched by scheduled time, the feeds name them differently and do not list the same ones; a stop
 * missing from the twin keeps the delay of the stop before it, the ones before the first stop of the twin keep their times
 * (the twin may be only the part of the trip in France). A train does not leave before its scheduled time.
 */
fun ItineraryDto.withRealTimeOf(twin: ItineraryDto): ItineraryDto {
    val twinStops = twin.legs.filter { it.tripId != null && it.realTime }.flatMap { it.stops() }
    if (legs.isEmpty() || twinStops.isEmpty() || legs.any { it.tripId != null && it.realTime }) return this
    val bySchedule = mutableMapOf<String, PlaceDto>()
    twinStops.forEach { stop -> listOfNotNull(stop.scheduledArrival, stop.scheduledDeparture).forEach { bySchedule.putIfAbsent(it, stop) } }
    var delay: Duration? = null
    val merged =
        legs.map { leg ->
            if (leg.tripId == null) return@map leg
            val stops =
                leg.stops().map { stop ->
                    val same = (stop.scheduledDeparture ?: stop.scheduledArrival)?.let(bySchedule::get) ?: stop.scheduledArrival?.let(bySchedule::get)
                    val departureDelay = same?.let { delay(it.departure, it.scheduledDeparture) }
                    val arrivalDelay = same?.let { delay(it.arrival, it.scheduledArrival) } ?: departureDelay ?: delay ?: return@map stop
                    val leaving = departureDelay ?: arrivalDelay
                    delay = leaving
                    stop.copy(
                        arrival = stop.scheduledArrival.shifted(arrivalDelay) ?: stop.arrival,
                        departure = stop.scheduledDeparture.shifted(maxOf(leaving, Duration.ZERO)) ?: stop.departure,
                        cancelled = same?.cancelled ?: stop.cancelled,
                        track = stop.track ?: same?.track,
                    )
                }
            val start = stops.first().departure ?: leg.startTime
            val end = stops.last().arrival ?: leg.endTime
            leg.copy(
                from = stops.first(),
                intermediateStops = leg.intermediateStops?.let { stops.subList(1, stops.size - 1) },
                to = stops.last(),
                startTime = start,
                endTime = end,
                durationSeconds = (Instant.parse(end) - Instant.parse(start)).inWholeSeconds,
                realTime = true,
            )
        }
    val start = merged.first().startTime
    val end = merged.last().endTime
    return copy(legs = merged, startTime = start, endTime = end, durationSeconds = (Instant.parse(end) - Instant.parse(start)).inWholeSeconds)
}

private fun LegDto.stops(): List<PlaceDto> = listOf(from) + intermediateStops.orEmpty() + to

private fun String?.shifted(delay: Duration): String? = this?.let { (Instant.parse(it) + delay).toString() }
