package org.litote.motis.mcp.dto

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
 * the French feed, numbered in the Italian one, are the numbered train of the same company at the same time.
 */
fun DeparturesResult.distinctTrains(): DeparturesResult {
    val unique = stopTimes.distinctBy { it.key() }
    fun StopTimeDto.slot() = scheduledTime to agency.lowercase()
    val numbered = unique.filter { it.mode in TRAIN_MODES && it.trainNumber != null }.map { it.slot() }.toSet()
    return copy(stopTimes = unique.filter { it.mode !in TRAIN_MODES || it.trainNumber != null || it.slot() !in numbered })
}

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
