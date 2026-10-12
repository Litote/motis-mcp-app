package org.litote.motis.mcp.lambda

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.litote.motis.mcp.MotisGateway
import org.litote.motis.mcp.MotisMcpConfig
import org.litote.motis.mcp.apps.UiView
import org.litote.motis.mcp.createMotisMcpServer
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class McpLambdaTest {
    private val lambda =
        MotisMcpConfig(contact = "https://example.org/tests").let { config ->
            McpLambda {
                createMotisMcpServer(
                    MotisGateway(config.clientConfiguration()),
                    config.baseUrl,
                    config.tiles,
                    UiView.entries.associateWith { "<html><head></head><body>${it.name}</body></html>" },
                )
            }
        }

    private fun event(method: String, body: String? = null, path: String = "/mcp"): String =
        lambdaJson.encodeToString(
            FunctionUrlEvent(
                requestContext = FunctionUrlEvent.RequestContext(FunctionUrlEvent.Http(method, path)),
                headers =
                    mapOf(
                        "host" to "abc.lambda-url.eu-west-3.on.aws",
                        "content-type" to "application/json",
                        "accept" to "application/json, text/event-stream",
                        "mcp-protocol-version" to "2025-11-25",
                    ),
                body = body,
            ),
        )

    private fun call(method: String, body: String? = null, path: String = "/mcp"): FunctionUrlResponse =
        lambdaJson.decodeFromString(lambda.handle(event(method, body, path)))

    private fun rpc(method: String, params: String = "{}"): JsonObject {
        val response = call("POST", """{"jsonrpc":"2.0","id":1,"method":"$method","params":$params}""")
        assertEquals(200, response.statusCode, response.body)
        assertTrue(response.headers.entries.any { it.key.equals("content-type", true) && it.value.startsWith("application/json") })
        assertEquals(false, response.base64Encoded)
        return lambdaJson.parseToJsonElement(response.body!!).jsonObject.getValue("result").jsonObject
    }

    @Test
    fun `initialize without session`() {
        val response =
            call(
                "POST",
                """{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}""",
            )
        assertEquals(200, response.statusCode, response.body)
        assertTrue(response.headers.keys.none { it.equals("mcp-session-id", true) })
        val result = lambdaJson.parseToJsonElement(response.body!!).jsonObject.getValue("result").jsonObject
        assertEquals("motis-mcp-app", result.getValue("serverInfo").jsonObject.getValue("name").jsonPrimitive.content)
    }

    @Test
    fun `tools listed without initialization, as each request may reach another instance`() {
        val tools = rpc("tools/list").getValue("tools").jsonArray.map { it.jsonObject.getValue("name").jsonPrimitive.content }
        assertTrue("plan_journey" in tools && "departures" in tools, tools.toString())
    }

    @Test
    fun `view resources are served`() {
        val contents = rpc("resources/read", """{"uri":"${UiView.DEPARTURES.uri}"}""").getValue("contents").jsonArray
        assertTrue(contents.single().jsonObject.getValue("text").jsonPrimitive.content.contains("DEPARTURES"))
    }

    @Test
    fun `GET is rejected as no SSE stream is offered`() {
        assertEquals(405, call("GET").statusCode)
    }

    @Test
    fun `unknown path is not found`() {
        assertEquals(404, call("POST", "{}", path = "/other").statusCode)
    }

    @Test
    fun `invalid event is a technical error`() {
        val response = lambdaJson.decodeFromString<FunctionUrlResponse>(lambda.handle("not json"))
        assertEquals(500, response.statusCode)
        assertNull(response.body)
    }
}
