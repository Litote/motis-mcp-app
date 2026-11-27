package org.litote.motis.mcp.lambda

import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlin.io.encoding.Base64
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class RequestGuardTest {
    private var now = 1_000_000_040_000L // 20 s after the start of a minute
    private val logs = mutableListOf<String>()

    private fun guard(secret: String? = "s3cret", limit: Int = 2) = RequestGuard(secret, limit, { now }, { logs += it })

    private fun event(
        method: String = "tools/call",
        secret: String? = "s3cret",
        viewer: String? = "198.51.100.10:46532",
        sourceIp: String = "130.176.1.1",
        base64: Boolean = false,
    ): FunctionUrlEvent {
        val body = """{"jsonrpc":"2.0","id":7,"method":"$method","params":{"name":"departures","arguments":{}}}"""
        return FunctionUrlEvent(
            requestContext = FunctionUrlEvent.RequestContext(FunctionUrlEvent.Http("POST", "/mcp", sourceIp)),
            headers =
                buildMap {
                    put("content-type", "application/json")
                    secret?.let { put(ORIGIN_SECRET_HEADER, it) }
                    viewer?.let { put(VIEWER_ADDRESS_HEADER, it) }
                },
            body = if (base64) Base64.encode(body.encodeToByteArray()) else body,
            base64Encoded = base64,
        )
    }

    @Test
    fun `requests without the origin secret are rejected, and logged once a minute`() {
        val guard = guard()
        assertNull(guard.check(event()))
        repeat(3) { assertEquals(403, guard.check(event(secret = null))?.statusCode) }
        assertEquals(403, guard.check(event(secret = "wrong"))?.statusCode)
        assertEquals(1, logs.size)
        assertTrue(logs[0].startsWith("$ORIGIN_REJECTED_MARKER: 1 request(s)"), logs[0])

        now += 60_000
        assertEquals(403, guard.check(event(secret = null))?.statusCode)
        assertEquals(2, logs.size)
        assertTrue(logs[1].startsWith("$ORIGIN_REJECTED_MARKER: 4 request(s)"), logs[1])
    }

    @Test
    fun `without secret, every request is accepted`() {
        val guard = guard(secret = null, limit = 0)
        assertNull(guard.check(event(secret = null)))
        assertNull(guard.check(event(secret = "anything")))
        assertTrue(logs.isEmpty())
    }

    @Test
    fun `tool calls above the limit are answered by a tool error, logged once per client and per minute`() {
        val guard = guard()
        repeat(2) { assertNull(guard.check(event())) }
        repeat(3) {
            val response = assertNotNull(guard.check(event()))
            assertEquals(200, response.statusCode)
            assertEquals("40", response.headers["retry-after"])
            val rpc = lambdaJson.parseToJsonElement(response.body!!).jsonObject
            assertEquals(7, rpc.getValue("id").jsonPrimitive.int)
            val result = rpc.getValue("result").jsonObject
            assertTrue(result.getValue("isError").jsonPrimitive.boolean)
            val text = result.getValue("content").jsonArray[0].jsonObject.getValue("text").jsonPrimitive.content
            assertEquals("Rate limit of the server reached (2 tool calls a minute): retry in 40 seconds", text)
        }
        assertEquals(1, logs.size)
        assertTrue(logs[0].matches(Regex("$RATE_LIMITED_MARKER: client [0-9a-f]{12} above 2 tool calls a minute")), logs[0])
        assertTrue("198.51.100.10" !in logs[0])

        // another client, the other methods: not limited
        assertNull(guard.check(event(viewer = "198.51.100.11:1234")))
        assertNull(guard.check(event(method = "tools/list")))

        // next window
        now += 40_000
        assertNull(guard.check(event()))
    }

    @Test
    fun `the clients of an IPv6 network share their limit`() {
        val guard = guard(limit = 1)
        assertNull(guard.check(event(viewer = "2001:db8:1:2::1:46532")))
        assertNotNull(guard.check(event(viewer = "2001:db8:1:2:aaaa:bbbb:cccc:dddd:443")))
        assertNull(guard.check(event(viewer = "2001:db8:1:3::1:443")))
    }

    @Test
    fun `base64 bodies are read`() {
        val guard = guard(limit = 1)
        assertNull(guard.check(event(base64 = true)))
        assertNotNull(guard.check(event(base64 = true)))
    }

    @Test
    fun `without viewer address, the source IP is the client, and the missing header is logged once`() {
        val guard = guard(limit = 1)
        assertNull(guard.check(event(viewer = null)))
        assertNotNull(guard.check(event(viewer = null)))
        assertEquals(2, logs.size)
        assertTrue(logs[0].startsWith("No $VIEWER_ADDRESS_HEADER header"), logs[0])
    }

    @Test
    fun `the guard is configured from the environment`() {
        assertNull(RequestGuard.fromEnv(emptyMap()).check(event(secret = null)))
        val guard = RequestGuard.fromEnv(mapOf(ORIGIN_SECRET_ENV to "s3cret", RATE_LIMIT_ENV to " 1 "))
        assertEquals(403, guard.check(event(secret = null))?.statusCode)
        assertNull(guard.check(event()))
        assertNotNull(guard.check(event()))
        assertFailsWith<IllegalArgumentException> { RequestGuard.fromEnv(mapOf(RATE_LIMIT_ENV to "many")) }
        assertFailsWith<IllegalArgumentException> { RequestGuard.fromEnv(mapOf(RATE_LIMIT_ENV to "-1")) }
    }
}
