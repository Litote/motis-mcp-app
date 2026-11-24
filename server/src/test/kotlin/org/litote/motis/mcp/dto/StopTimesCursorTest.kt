package org.litote.motis.mcp.dto

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.time.Instant

class StopTimesCursorTest {
    private val time = Instant.parse("2026-11-24T08:00:00Z")

    @Test
    fun `the cursors have the format of MOTIS`() {
        assertEquals("EARLIER|1795507200", StopTimesCursor.earlier(time))
        assertEquals("LATER|1795507200", StopTimesCursor.later(time))
    }

    @Test
    fun `only the cursors of a previous page are earlier`() {
        assertTrue(StopTimesCursor.isEarlier(StopTimesCursor.earlier(time)))
        assertFalse(StopTimesCursor.isEarlier(StopTimesCursor.later(time)))
        assertFalse(StopTimesCursor.isEarlier("EARLIERX"))
    }
}
