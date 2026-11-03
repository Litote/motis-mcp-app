package org.litote.motis.mcp.lambda

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import kotlin.system.exitProcess

private const val PORT = 8090

/** Resource answering a request of the journeys from Paris to Nantes, null for any other request. */
private fun fixture(path: String, query: Map<String, String>): String? =
    when (path) {
        "/api/v1/geocode" -> mapOf("Paris" to "geocode-paris", "Nantes" to "geocode-nantes")[query["text"]]
        // the centers of the cities are coordinates, the stations are stop ids
        "/api/v6/plan" -> if (query["fromPlace"].orEmpty().contains(',')) "plan-centers" else "plan-stations"
        else -> null
    }

private fun HttpExchange.respond() {
    val query = requestURI.query.orEmpty().split('&').associate { it.substringBefore('=') to it.substringAfter('=') }
    val body = fixture(requestURI.path, query)?.let { object {}.javaClass.getResourceAsStream("/motis/$it.json")!!.readBytes() }
    println("MOTIS: $requestMethod $requestURI -> ${if (body == null) 404 else 200}")
    if (body == null) {
        sendResponseHeaders(404, -1)
    } else {
        responseHeaders.add("Content-Type", "application/json")
        sendResponseHeaders(200, body.size.toLong())
        responseBody.write(body)
    }
    close()
}

/**
 * Runs the command [args] (the smoke test of the native executable, see `:lambda:smokeTest`) with a mock of the MOTIS API,
 * so that it does not depend on Transitous: its port is in `MOCK_MOTIS_PORT`. The fixtures are answers of Transitous,
 * shortened (2 itineraries, without geometry); any other request gets a 404, which fails the smoke test.
 */
fun main(args: Array<String>) {
    val server = HttpServer.create(InetSocketAddress(PORT), 0)
    server.createContext("/") { it.respond() }
    server.start()
    val command = ProcessBuilder(*args).inheritIO()
    command.environment()["MOCK_MOTIS_PORT"] = "$PORT"
    val status = command.start().waitFor()
    server.stop(0)
    exitProcess(status)
}
