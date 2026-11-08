package org.litote.motis.mcp.tools

import io.modelcontextprotocol.kotlin.sdk.client.Client
import io.modelcontextprotocol.kotlin.sdk.server.Server
import io.modelcontextprotocol.kotlin.sdk.server.ServerOptions
import io.modelcontextprotocol.kotlin.sdk.types.Implementation
import io.modelcontextprotocol.kotlin.sdk.types.ServerCapabilities
import io.modelcontextprotocol.kotlin.sdk.types.TextContent
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import org.litote.motis.client.model.Mode
import org.litote.motis.mcp.InMemoryTransport
import org.litote.motis.mcp.MotisToolException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.seconds

class ToolSupportTest {
    @Test
    fun `the logged arguments have rounded coordinates and truncated values`() {
        val arguments =
            buildJsonObject {
                put("from", "Paris")
                put("position", "48.85341, 2.34880")
                put("to", "45.7605,4.8597")
                put("count", 5)
                put("wheelchair", true)
                putJsonArray("modes") {
                    add("RAIL")
                    add("BUS")
                }
                put("pageCursor", "x".repeat(150))
            }

        assertEquals(
            "from=\"Paris\", position=\"48.85,2.35\", to=\"45.76,4.86\", count=5, wheelchair=true, modes=[\"RAIL\",\"BUS\"], " +
                "pageCursor=\"${"x".repeat(100)}\"",
            arguments.forLog(),
        )
        assertEquals("near -33.87,151.21 and 1.5", roundCoordinates("near -33.8688,151.2093 and 1.5"))
    }

    private fun modes(vararg values: String): List<Mode>? =
        Args(buildJsonObject { putJsonArray("modes") { values.forEach { add(it) } } }).modes("modes")

    @Test
    fun `transit modes follow the MOTIS modes, street modes excluded`() {
        assertTrue("METRO" in TRANSIT_MODES && "CABLE_CAR" in TRANSIT_MODES && "TRANSIT" in TRANSIT_MODES)
        assertTrue("WALK" !in TRANSIT_MODES && "AREAL_LIFT" !in TRANSIT_MODES && "UNKNOWN_" !in TRANSIT_MODES)
        assertEquals(listOf(Mode.METRO, Mode.BUS), modes("metro", "BUS"))
        val error = assertFailsWith<MotisToolException> { modes("WALK") }
        assertTrue(error.message!!.startsWith("Invalid argument: unknown mode 'WALK'"), error.message)
    }

    @Test
    fun `unexpected exceptions are generic tool errors`() =
        runBlocking {
            withTimeout(30.seconds) {
                val server =
                    Server(
                        Implementation("tests", "1.0"),
                        ServerOptions(ServerCapabilities(tools = ServerCapabilities.Tools(listChanged = false))),
                    ).apply {
                        motisTool(name = "broken", title = "Broken", description = "Fails.") { error("secret details") }
                    }
                val (clientTransport, serverTransport) = InMemoryTransport.pair()
                server.createSession(serverTransport)
                val client = Client(Implementation("tests", "1.0"))
                client.connect(clientTransport)
                try {
                    val result = client.callTool("broken", emptyMap())

                    assertEquals(true, result.isError)
                    assertEquals("Internal error of the tool broken", (result.content.single() as TextContent).text)
                } finally {
                    client.close()
                }
            }
        }
}
