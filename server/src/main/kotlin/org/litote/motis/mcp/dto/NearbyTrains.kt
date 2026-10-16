package org.litote.motis.mcp.dto

import kotlin.time.Duration.Companion.minutes
import kotlin.time.Instant

/** Distance (m) of the stops of the same station in the other feeds: "Gare de Lyon" (IDFM) and "Paris Gare de Lyon Hall 1 - 2" (SNCF). */
const val STATION_RADIUS = 200L

/**
 * Departures (or arrivals) of a stop merged with the trains of the stops of the same station in the other feeds ([nearby]),
 * both pages of at most about [n] stop times from the same cursor.
 *
 * Stop times are sorted by (real-time) time, as MOTIS does, and the page is cut where both lists are complete: its cursors are
 * the ones of MOTIS, "LATER|<epoch s>" (stop times from that time) and "EARLIER|<epoch s>" (stop times until that time).
 */
fun DeparturesResult.withNearbyTrains(nearby: DeparturesResult, n: Int, earlier: Boolean): DeparturesResult {
    val known = stopTimes.mapTo(mutableSetOf()) { it.key() }
    val added = nearby.stopTimes.filter { known.add(it.key()) }
    if (added.isEmpty()) return this
    val all = (stopTimes + added).sortedBy { it.instant() }
    val pages = listOf(this, nearby).filter { it.stopTimes.size >= n }
    return if (earlier) {
        // the earliest stop time of a full page: the ones before it may be missing from the other list
        val horizon = pages.maxOfOrNull { it.stopTimes.first().instant() }
        val complete = all.filter { horizon == null || it.instant() >= horizon }
        val cut = complete.size > n && complete[complete.size - n].instant() > complete.first().instant()
        // the stop times of the minute of the first kept one may be on both pages: keep them for the previous one
        val lastDropped = if (cut) complete[complete.size - n - 1].instant() else null
        val kept = if (lastDropped != null) complete.filter { it.instant() > lastDropped } else complete
        copy(
            stopTimes = kept,
            previousPageCursor = cursor("EARLIER", lastDropped ?: horizon?.minus(1.minutes)) ?: previousPageCursor,
            nextPageCursor = cursor("LATER", kept.lastOrNull()?.instant()?.plus(1.minutes)) ?: nextPageCursor,
        )
    } else {
        // the latest stop time of a full page: the ones after it may be missing from the other list
        val horizon = pages.minOfOrNull { it.stopTimes.last().instant() }
        val complete = all.filter { horizon == null || it.instant() <= horizon }
        val cut = complete.size > n && complete[n].instant() > complete.first().instant()
        // the stop times of the minute of the first dropped one are on the next page
        val firstDropped = if (cut) complete[n].instant() else null
        val kept = if (firstDropped != null) complete.filter { it.instant() < firstDropped } else complete
        copy(
            stopTimes = kept,
            previousPageCursor = cursor("EARLIER", kept.firstOrNull()?.instant()?.minus(1.minutes)) ?: previousPageCursor,
            nextPageCursor = cursor("LATER", firstDropped ?: horizon?.plus(1.minutes)) ?: nextPageCursor,
        )
    }
}

private fun cursor(direction: String, time: Instant?): String? = time?.let { "$direction|${it.epochSeconds}" }

internal fun StopTimeDto.instant(): Instant = Instant.parse(time ?: scheduledTime ?: error("stop time without time: $tripId"))

/**
 * The same train in two feeds has two trip ids, but the same scheduled time and number: the trip_short_name, or the headsign
 * of the SNCF regional trains ("847447" for the train "C17").
 */
internal fun StopTimeDto.key(): String {
    val number = trainNumber ?: headsign.takeIf { it.isNotEmpty() && it.all(Char::isDigit) }
    return if (number != null) "$scheduledTime $number" else tripId
}
