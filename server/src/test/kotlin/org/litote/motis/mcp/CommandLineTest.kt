package org.litote.motis.mcp

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class CommandLineTest {
    @Test
    fun `stdio is the default mode`() {
        assertEquals(CliOptions(), parseArguments(emptyArray()))
        assertEquals(CliOptions(), parseArguments(arrayOf("--stdio")))
    }

    @Test
    fun `http mode takes a port and a host`() {
        assertEquals(CliOptions(http = true), parseArguments(arrayOf("--http")))
        assertEquals(
            CliOptions(http = true, port = 8080, host = "0.0.0.0"),
            parseArguments(arrayOf("--http", "--port", "8080", "--host", "0.0.0.0")),
        )
    }

    @Test
    fun `invalid ports are usage errors`() {
        assertEquals("invalid port \"abc\"", assertFailsWith<UsageException> { parseArguments(arrayOf("--http", "--port", "abc")) }.message)
        assertEquals("invalid port \"70000\"", assertFailsWith<UsageException> { parseArguments(arrayOf("--http", "--port", "70000")) }.message)
    }

    @Test
    fun `options without value are usage errors`() {
        assertEquals("--port requires a value", assertFailsWith<UsageException> { parseArguments(arrayOf("--http", "--port")) }.message)
        assertEquals("--host requires a value", assertFailsWith<UsageException> { parseArguments(arrayOf("--host", "--http")) }.message)
    }
}
