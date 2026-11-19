package org.litote.motis.mcp.dto

import kotlin.time.Duration
import kotlin.time.Instant

/** Line name of a stop time, without the number of the train: "TGV INOUI 6633" is the line "TGV INOUI". */
fun StopTimeDto.lineName(): String = TRAIN_NUMBER.replace(line.trim(), "")

private val TRAIN_NUMBER = Regex("""\s+\d+$""")

/** Distinct lines of the stop times of [results], in the order of their first stop time. */
fun stationLines(results: List<DeparturesResult>): List<StationLineDto> =
    results
        .flatMap { it.stopTimes }
        .distinctBy { Triple(it.mode, it.lineName(), it.agency) }
        .map { StationLineDto(it.mode, it.lineName(), it.agency, it.routeColor, it.routeTextColor) }

private val TRAIN_MODES = setOf("RAIL", "HIGHSPEED_RAIL", "LONG_DISTANCE", "NIGHT_RAIL", "REGIONAL_FAST_RAIL", "REGIONAL_RAIL", "SUBURBAN")

/**
 * The same train in two feeds of the station is kept once, also when a feed has no train number: the Trenitalia trains of
 * the French feed, numbered in the Italian one, are the numbered train of the same company and line at the same time. The
 * kept one takes the real time of the other when only the other has it: the Italian feed has no real time in France.
 */
fun DeparturesResult.distinctTrains(): DeparturesResult = copy(stopTimes = stopTimes.distinctTrains())

/** The stop times of the same train in several feeds kept once, sorted by time (see [DeparturesResult.distinctTrains]). */
internal fun List<StopTimeDto>.distinctTrains(): List<StopTimeDto> {
    val unique = groupBy { it.key() }.values.map { same -> same.first().withRealTimeOf(same) }
    fun StopTimeDto.slot() = Triple(scheduledTime, agency.lowercase(), lineName())
    val unnumbered = unique.filter { it.mode in TRAIN_MODES && it.trainNumber == null }.groupBy { it.slot() }
    val numbered = unique.filter { it.mode in TRAIN_MODES && it.trainNumber != null }.map { it.slot() }.toSet()
    val kept =
        unique.mapNotNull {
            when {
                it.mode !in TRAIN_MODES -> it
                it.trainNumber != null -> it.withRealTimeOf(unnumbered[it.slot()].orEmpty())
                it.slot() in numbered -> null
                else -> it
            }
        }
    return kept.sortedBy { it.instant() }
}

/** This stop time with the real time of one of its [twins] (the same train in other feeds), when it has none. */
private fun StopTimeDto.withRealTimeOf(twins: List<StopTimeDto>): StopTimeDto {
    if (realTime) return this
    val twin = twins.firstOrNull { it.realTime } ?: return this
    return copy(
        time = twin.time,
        realTime = true,
        cancelled = twin.cancelled,
        track = track ?: twin.track,
        realTimeSource = twin.realTimeSource,
        stops = stops?.withTimesOf(twin) ?: twin.stops,
    )
}

/**
 * These stops with the real times of the same stops of [twin], matched by scheduled time: the feeds name them differently
 * ("PARIS GARE DE LYON", "Paris-Gare-de-Lyon") and do not list the same ones (Modane in one only). A stop missing from the
 * twin keeps the delay of the stop before it (of the departure for the first one).
 */
private fun List<StopCallDto>.withTimesOf(twin: StopTimeDto): List<StopCallDto> {
    val times = twin.stops.orEmpty().filter { it.scheduledTime != null && it.time != null }.associate { it.scheduledTime to it.time }
    var delay = delay(twin.time, twin.scheduledTime) ?: Duration.ZERO
    return map { stop ->
        val scheduled = stop.scheduledTime ?: return@map stop
        val time = times[scheduled]
        if (time != null) {
            delay = delay(time, scheduled) ?: delay
            stop.copy(time = time)
        } else {
            stop.copy(time = (Instant.parse(scheduled) + delay).toString())
        }
    }
}

private fun delay(time: String?, scheduled: String?): Duration? =
    if (time == null || scheduled == null) null else Instant.parse(time) - Instant.parse(scheduled)

/** Stop times of these [lines] (see [lineName]) only. */
fun DeparturesResult.onLines(lines: Set<String>): DeparturesResult = copy(stopTimes = stopTimes.filter { it.lineName() in lines })

/**
 * This page followed by the [next] one in the paging direction ([earlier]: the previous page): the stop times of both, the
 * cursors of the pages at both ends.
 */
fun DeparturesResult.followedBy(next: DeparturesResult, earlier: Boolean): DeparturesResult =
    copy(
        stopTimes = (stopTimes + next.stopTimes).distinctBy { it.key() }.sortedBy { it.instant() },
        previousPageCursor = if (earlier) next.previousPageCursor else previousPageCursor,
        nextPageCursor = if (earlier) nextPageCursor else next.nextPageCursor,
    )
