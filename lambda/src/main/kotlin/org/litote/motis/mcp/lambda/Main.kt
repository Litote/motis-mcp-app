package org.litote.motis.mcp.lambda

import com.asyncant.aws.lambda.runtime.runLambda
import io.github.oshai.kotlinlogging.KotlinLogging
import io.ktor.server.engine.EmbeddedServer
import io.ktor.server.engine.embeddedServer
import io.ktor.server.routing.RoutingContext
import io.modelcontextprotocol.kotlin.sdk.server.Server
import io.modelcontextprotocol.kotlin.sdk.server.mcpStatelessStreamableHttp
import kotlinx.coroutines.runBlocking
import org.litote.motis.mcp.MCP_ROUTE
import org.litote.motis.mcp.MotisGateway
import org.litote.motis.mcp.MotisMcpConfig
import org.litote.motis.mcp.createMotisMcpServer
import org.litote.motis.mcp.apps.loadViews
import org.litote.motis.mcp.rejectUnknownMcpHosts
import org.litote.motis.mcp.viewDomain

private val logger = KotlinLogging.logger {}

/**
 * MCP endpoints `/mcp` and `/mcp/<host>` of the Lambda, in stateless Streamable HTTP mode: successive requests of a client may reach
 * different Lambda instances, so no session is kept in memory. Every request is answered in JSON (no SSE stream).
 *
 * The DNS rebinding protection is disabled: it protects servers listening on localhost, this endpoint is public.
 * The Ktor application is built once per Lambda instance and reused by its invocations.
 */
class McpLambda(createServer: RoutingContext.() -> Server) {
    private val server: EmbeddedServer<LambdaEngine, LambdaEngine.Configuration> =
        embeddedServer(LambdaEngine) {
            rejectUnknownMcpHosts()
            mcpStatelessStreamableHttp(path = MCP_ROUTE, enableDnsRebindingProtection = false) { createServer() }
        }.apply { start(wait = false) }

    suspend fun handle(event: FunctionUrlEvent): FunctionUrlResponse = server.engine.handle(event)

    /** Handles a function URL event serialized in JSON. */
    fun handle(event: String): String {
        val response =
            try {
                runBlocking { handle(lambdaJson.decodeFromString<FunctionUrlEvent>(event)) }
            } catch (e: Exception) {
                logger.error(e) { "Technical error: ${e.message}" }
                FunctionUrlResponse(statusCode = 500)
            }
        return lambdaJson.encodeToString(response)
    }
}

/** MCP server of the Lambda, configured from the environment (see the README). */
fun createMcpLambda(): McpLambda {
    val config = MotisMcpConfig.fromEnv()
    val gateway = MotisGateway(config.clientConfiguration())
    val views = loadViews(config.tiles)
    return McpLambda { createMotisMcpServer(gateway, config.baseUrl, config.tiles, views, viewDomain(config)) }
}

fun main() {
    System.setProperty("kotlin-logging.logStartupMessage", "false")
    val lambda = createMcpLambda()
    logger.info { "MCP Lambda started" }
    runLambda { event, _ -> lambda.handle(event) }
}
