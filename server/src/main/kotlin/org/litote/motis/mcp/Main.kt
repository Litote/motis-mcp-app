package org.litote.motis.mcp

import io.github.oshai.kotlinlogging.KotlinLogging
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.server.application.install
import io.ktor.server.cio.CIO
import io.ktor.server.engine.embeddedServer
import io.ktor.server.plugins.cors.routing.CORS
import io.modelcontextprotocol.kotlin.sdk.server.StdioServerTransport
import io.modelcontextprotocol.kotlin.sdk.server.mcpStatelessStreamableHttp
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.runBlocking
import kotlinx.io.asSink
import kotlinx.io.asSource
import kotlinx.io.buffered

// lazy: the logging library must be configured before its first use (see main)
private val logger by lazy { KotlinLogging.logger {} }

private const val USAGE =
    """
Usage: motis-mcp-app [--stdio | --http [--port <port>] [--host <host>]]

  --stdio          MCP over stdin/stdout (default)
  --http           MCP over Streamable HTTP, endpoint /mcp (and /mcp/chatgpt, /mcp/claude, /mcp/mistral, /mcp/cherry)
  --port <port>    HTTP port (default 3001)
  --host <host>    HTTP bind address (default 127.0.0.1)

Environment:
  MOTIS_APP_CONTACT    e-mail address or website URL sent in the User-Agent: required with Transitous (usage policy)
  MOTIS_BASE_URL       MOTIS API (default https://api.transitous.org/)
  MOTIS_LOG_LEVEL      Ktor client log level: NONE (default), INFO, HEADERS, BODY, ALL
  MOTIS_TILE_URL       raster tiles of the maps (default https://tile.openstreetmap.org/{z}/{x}/{y}.png)
  MOTIS_TILE_ATTRIBUTION  attribution of the tiles (HTML)
  MOTIS_VIEW_DOMAIN_<HOST>  dedicated origin of the views (_meta.ui.domain) on the endpoint /mcp/<host> of a host:
                       CHATGPT, CLAUDE (default: computed from the endpoint URL), MISTRAL, CHERRY
  MCP_ALLOWED_HOSTS    comma-separated host names accepted in HTTP mode (default: localhost only)
"""

fun main(args: Array<String>) {
    // kotlin-logging prints a startup message on stdout, which carries the MCP protocol in stdio mode
    System.setProperty("kotlin-logging.logStartupMessage", "false")
    if ("--help" in args || "-h" in args) {
        println(USAGE.trimIndent())
        return
    }
    val config = MotisMcpConfig.fromEnv()
    val gateway = MotisGateway(config.clientConfiguration())
    val views = loadViews()
    val create = { viewDomain: String? -> createMotisMcpServer(gateway, config.baseUrl, config.tiles, views, viewDomain) }

    if ("--http" in args) {
        val port = args.option("--port")?.toInt() ?: 3001
        val host = args.option("--host") ?: "127.0.0.1"
        val allowedHosts = System.getenv("MCP_ALLOWED_HOSTS")?.split(',')?.map { it.trim() }?.filter { it.isNotEmpty() }
        logger.info { "MCP server listening on http://$host:$port$MCP_PATH (MOTIS: ${config.baseUrl})" }
        embeddedServer(CIO, host = host, port = port) {
            install(CORS) {
                anyHost()
                allowMethod(HttpMethod.Get)
                allowMethod(HttpMethod.Post)
                allowMethod(HttpMethod.Delete)
                allowHeader(HttpHeaders.ContentType)
                allowHeader(HttpHeaders.Authorization)
                allowHeader("Mcp-Protocol-Version")
            }
            rejectUnknownMcpHosts()
            // stateless, as the Lambda: the tools keep no state, and the SDK never expires the idle sessions of the
            // stateful mode (a long-running server would keep those of every client in memory)
            mcpStatelessStreamableHttp(path = MCP_ROUTE, allowedHosts = allowedHosts?.plus(listOf("localhost", "127.0.0.1"))) {
                create(viewDomain(config))
            }
        }.start(wait = true)
    } else {
        runBlocking {
            val server = create(null)
            val transport = StdioServerTransport(input = System.`in`.asSource().buffered(), output = System.out.asSink().buffered())
            val closed = CompletableDeferred<Unit>()
            // the session is closed at the end of stdin (client gone): the process exits
            server.createSession(transport).onClose { closed.complete(Unit) }
            logger.info { "MCP server running on stdio (MOTIS: ${config.baseUrl})" }
            closed.await()
        }
    }
}

private fun Array<String>.option(name: String): String? = indexOf(name).takeIf { it >= 0 }?.let { getOrNull(it + 1) }
