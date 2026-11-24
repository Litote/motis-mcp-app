package org.litote.motis.mcp.dto

import kotlin.time.Instant

/**
 * Cursors of the stop times of MOTIS: "LATER|<epoch s>" (stop times from that time) and "EARLIER|<epoch s>" (stop times
 * until that time). The pages merged by the server are cut with cursors of the same format, and the direction of a
 * cursor tells how to merge the next pages: the format of MOTIS is only known here.
 */
internal object StopTimesCursor {
    private const val EARLIER = "EARLIER"
    private const val LATER = "LATER"

    /** Cursor of the stop times until [time]. */
    fun earlier(time: Instant): String = "$EARLIER|${time.epochSeconds}"

    /** Cursor of the stop times from [time]. */
    fun later(time: Instant): String = "$LATER|${time.epochSeconds}"

    /** True for the cursor of a previous page. */
    fun isEarlier(cursor: String): Boolean = cursor.startsWith("$EARLIER|")
}
