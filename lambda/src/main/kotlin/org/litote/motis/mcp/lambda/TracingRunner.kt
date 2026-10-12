package org.litote.motis.mcp.lambda

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import org.litote.motis.mcp.apps.UiView

// place of the traced calls: stops, routes and rentals around it
private const val PLACE = "Lyon Part-Dieu"

/**
 * Replays MCP requests through the Lambda handler, calling every tool against the MOTIS server, so that the
 * native-image agent records the reflection and resources metadata used at runtime (`./gradlew :lambda:tracing -Pagent`).
 */
fun main() {
    System.setProperty("kotlin-logging.logStartupMessage", "false")
    val lambda = createMcpLambda()
    var id = 0

    fun request(method: String, params: JsonObject = JsonObject(emptyMap())): JsonObject {
        val rpc =
            buildJsonObject {
                put("jsonrpc", "2.0")
                put("id", ++id)
                put("method", method)
                put("params", params)
            }
        val event =
            FunctionUrlEvent(
                requestContext = FunctionUrlEvent.RequestContext(FunctionUrlEvent.Http("POST", "/mcp")),
                headers =
                    mapOf(
                        "host" to "example.lambda-url.eu-west-3.on.aws",
                        "content-type" to "application/json",
                        "accept" to "application/json, text/event-stream",
                        "mcp-protocol-version" to "2025-11-25",
                    ),
                body = rpc.toString(),
            )
        val response = lambdaJson.decodeFromString<FunctionUrlResponse>(lambda.handle(lambdaJson.encodeToString(event)))
        val body = response.body?.let { lambdaJson.parseToJsonElement(it).jsonObject } ?: JsonObject(emptyMap())
        val error = (body["result"] as? JsonObject)?.get("isError") ?: body["error"]
        println("$method ${params["name"] ?: ""} -> ${response.statusCode}${error?.let { " error: $it" } ?: ""}")
        return body
    }

    fun callTool(name: String, vararg arguments: Pair<String, Any>): JsonObject =
        request(
            "tools/call",
            buildJsonObject {
                put("name", name)
                putJsonObject("arguments") {
                    arguments.forEach { (key, value) ->
                        when (value) {
                            is Number -> put(key, value)
                            is Boolean -> put(key, value)
                            else -> put(key, value.toString())
                        }
                    }
                }
            },
        )

    request(
        "initialize",
        buildJsonObject {
            put("protocolVersion", "2025-11-25")
            putJsonObject("capabilities") {}
            putJsonObject("clientInfo") {
                put("name", "tracing")
                put("version", "1.0")
            }
        },
    )
    request("tools/list")
    request("resources/list")
    UiView.entries.forEach { view -> request("resources/read", buildJsonObject { put("uri", view.uri) }) }

    callTool("server_info")
    callTool("search_places", "text" to PLACE)
    callTool("search_places", "text" to "45.7605,4.8597")
    val area = callTool("explore_area", "place" to PLACE, "radiusKm" to 1)
    area.firstValue("routeIdx")?.let { callTool("route_details", "routeIdx" to it.content.toLong()) }
    val departures = callTool("departures", "stop" to PLACE, "count" to 5)
    departures.firstValue("tripId")?.let { callTool("trip_details", "tripId" to it.content) }
    callTool("plan_journey", "from" to PLACE, "to" to "Villeurbanne")
    callTool("reachability", "place" to PLACE)
    callTool("rentals", "place" to PLACE, "radiusKm" to 1)
    // error path: MOTIS error and invalid arguments
    callTool("trip_details", "tripId" to "unknown")
    callTool("departures")
}

/** First primitive value of [key], searched depth-first. */
private fun JsonElement.firstValue(key: String): JsonPrimitive? =
    when (this) {
        is JsonObject -> (this[key] as? JsonPrimitive) ?: values.firstNotNullOfOrNull { it.firstValue(key) }
        is JsonArray -> firstNotNullOfOrNull { it.firstValue(key) }
        else -> null
    }
