package org.litote.motis.mcp.dto

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class ColorTest {
    @Test
    fun `feed colors are normalized`() {
        assertEquals("#e8308a", color("e8308a"))
        assertEquals("#E8308A", color("#E8308A"))
        assertEquals("#e8308a", color(" e8308a "))
    }

    @Test
    fun `invalid colors are dropped`() {
        assertNull(color(null))
        assertNull(color(""))
        assertNull(color("red"))
        assertNull(color("#fff;background:url(https://example.org/x.png)"))
        assertNull(color("e8308a\"><script>"))
    }
}
