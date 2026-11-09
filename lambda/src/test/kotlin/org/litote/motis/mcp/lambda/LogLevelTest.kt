package org.litote.motis.mcp.lambda

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class LogLevelTest {
    @Test
    fun `the level of the logs is read from the environment`() {
        assertNull(logLevel(emptyMap()))
        assertNull(logLevel(mapOf(LOG_LEVEL_ENV to " ")))
        assertEquals("warn", logLevel(mapOf(LOG_LEVEL_ENV to " WARN ")))
        val error = assertFailsWith<IllegalArgumentException> { logLevel(mapOf(LOG_LEVEL_ENV to "verbose")) }
        assertTrue(error.message!!.startsWith("$LOG_LEVEL_ENV must be one of "), error.message)
    }
}
