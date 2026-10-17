package org.litote.motis.mcp

import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.engine.HttpClientEngineConfig
import io.ktor.client.engine.HttpClientEngineFactory
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.modelcontextprotocol.kotlin.sdk.client.Client
import io.modelcontextprotocol.kotlin.sdk.types.Implementation
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.litote.motis.mcp.apps.UiView
import org.litote.motis.mcp.apps.loadViews
import java.util.Collections
import kotlin.time.Duration.Companion.seconds

/** MOTIS API replaced by a [MockEngine]: records the requests and answers with [handler]. */
class MockMotis(private val handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData) {
    // requests of an area are concurrent
    val requests: MutableList<HttpRequestData> = Collections.synchronizedList(mutableListOf())

    val engine: HttpClientEngineFactory<HttpClientEngineConfig> =
        object : HttpClientEngineFactory<HttpClientEngineConfig> {
            override fun create(block: HttpClientEngineConfig.() -> Unit): HttpClientEngine =
                MockEngine { request ->
                    requests += request
                    handler(request)
                }
        }
}

fun MockRequestHandleScope.respondJson(content: String, status: HttpStatusCode = HttpStatusCode.OK): HttpResponseData =
    respond(content, status, headersOf(HttpHeaders.ContentType, "application/json"))

/** Minimal views: the real ones are bundled by the UI build. */
val TEST_VIEWS: Map<UiView, String> =
    UiView.entries.associateWith { "<html><head></head><body>${it.name}</body></html>" }

/**
 * Runs [block] with an MCP client connected in memory to a server using [motis].
 * runBlocking rather than runTest: the virtual time of runTest would expire the request timeouts of the SDK.
 */
fun withMcpClient(motis: MockMotis, block: suspend (Client) -> Unit): Unit =
    runBlocking {
        withTimeout(30.seconds) {
            val config = MotisMcpConfig(contact = "https://example.org/tests")
            val server =
                createMotisMcpServer(
                    MotisGateway(config.clientConfiguration(motis.engine)),
                    config.baseUrl,
                    config.tiles,
                    loadViews(config.tiles) { TEST_VIEWS.getValue(it) },
                )
            val (clientTransport, serverTransport) = InMemoryTransport.pair()
            server.createSession(serverTransport)
            val client = Client(Implementation("tests", "1.0"))
            client.connect(clientTransport)
            try {
                block(client)
            } finally {
                client.close()
            }
        }
    }
