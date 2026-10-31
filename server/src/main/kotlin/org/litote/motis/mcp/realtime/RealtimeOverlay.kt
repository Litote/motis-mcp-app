package org.litote.motis.mcp.realtime

import org.litote.motis.client.model.StopTime

/**
 * Real time of another source applied to the stop times of a MOTIS feed, when MOTIS has none for them (e.g. its import
 * of the real time of the feed is broken). It never replaces the real time of MOTIS: when MOTIS has it again, the
 * overlay patches nothing.
 */
interface RealtimeOverlay {
    /** Name of the source, given with the stop times it gave the real time of (not only a track). */
    val source: String

    /** The stop times it patched, by index in [stopTimes], the others left as they are. Never fails: empty instead. */
    suspend fun patch(stopTimes: List<StopTime>): Map<Int, StopTime>
}
