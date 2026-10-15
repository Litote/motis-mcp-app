package org.litote.motis.mcp

import io.ktor.http.HttpStatusCode
import io.ktor.http.URLProtocol
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationCallPipeline
import io.ktor.server.application.call
import io.ktor.server.plugins.origin
import io.ktor.server.request.path
import io.ktor.server.response.respond
import io.ktor.server.routing.RoutingContext
import java.security.MessageDigest

/** Generic MCP endpoint: the views get the default sandbox origin of the host. */
const val MCP_PATH = "/mcp"

private const val HOST_PARAMETER = "host"

/** Route of the MCP endpoints: [MCP_PATH], and `/mcp/<host>` for the hosts of [McpHost]. */
const val MCP_ROUTE = "$MCP_PATH/{$HOST_PARAMETER?}"

/**
 * MCP hosts with a dedicated endpoint `/mcp/<path>`: the dedicated origin of the views (`_meta.ui.domain`) has a
 * host-specific format, while a server sends a single value. It is set by `MOTIS_VIEW_DOMAIN_<name>`.
 */
enum class McpHost(val path: String) {
    CHATGPT("chatgpt"),

    /** Without configuration, the origin is computed from the endpoint URL ([claudeViewDomain]). */
    CLAUDE("claude"),
    MISTRAL("mistral"),
    CHERRY("cherry"),
    ;

    val envName: String get() = "MOTIS_VIEW_DOMAIN_$name"

    companion object {
        fun of(path: String?): McpHost? = entries.firstOrNull { it.path == path }
    }
}

/** Dedicated origin of the views in Claude: derived from the URL of the MCP endpoint, as registered in Claude. */
fun claudeViewDomain(endpointUrl: String): String {
    val hash = MessageDigest.getInstance("SHA-256").digest(endpointUrl.toByteArray()).joinToString("") { "%02x".format(it) }
    return "${hash.take(32)}.claudemcpcontent.com"
}

/** Public URL of the MCP endpoint of the request, without query (default port omitted). */
fun RoutingContext.endpointUrl(): String {
    val origin = call.request.origin
    val port = origin.serverPort.takeIf { it != URLProtocol.createOrDefault(origin.scheme).defaultPort }?.let { ":$it" }
    return "${origin.scheme}://${origin.serverHost}${port.orEmpty()}${call.request.path()}"
}

/** Dedicated origin of the views for the endpoint of the request: `/mcp/<host>`, null for [MCP_PATH]. */
fun RoutingContext.viewDomain(config: MotisMcpConfig): String? {
    val host = McpHost.of(call.parameters[HOST_PARAMETER]) ?: return null
    return config.viewDomains[host] ?: claudeViewDomain(endpointUrl()).takeIf { host == McpHost.CLAUDE }
}

/** `/mcp/<host>` of an unknown host is not found (the optional parameter of [MCP_ROUTE] matches any name). */
fun Application.rejectUnknownMcpHosts() {
    intercept(ApplicationCallPipeline.Plugins) {
        val host = call.request.path().removePrefix("$MCP_PATH/").takeIf { call.request.path().startsWith("$MCP_PATH/") }
        if (!host.isNullOrEmpty() && McpHost.of(host) == null) {
            call.respond(HttpStatusCode.NotFound)
            finish()
        }
    }
}
