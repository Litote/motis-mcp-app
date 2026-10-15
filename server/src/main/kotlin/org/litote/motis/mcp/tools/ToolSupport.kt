package org.litote.motis.mcp.tools

import io.github.oshai.kotlinlogging.KotlinLogging
import io.modelcontextprotocol.kotlin.sdk.server.Server
import io.modelcontextprotocol.kotlin.sdk.types.CallToolResult
import io.modelcontextprotocol.kotlin.sdk.types.TextContent
import io.modelcontextprotocol.kotlin.sdk.types.Tool
import io.modelcontextprotocol.kotlin.sdk.types.ToolAnnotations
import io.modelcontextprotocol.kotlin.sdk.types.ToolSchema
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import org.litote.motis.client.model.Mode
import org.litote.motis.mcp.MotisToolException
import org.litote.motis.mcp.apps.ToolVisibility
import org.litote.motis.mcp.apps.UiView
import kotlin.time.Instant

private val logger = KotlinLogging.logger {}

internal val dtoJson =
    Json {
        encodeDefaults = true
        explicitNulls = false
    }

/** Transit modes accepted by the tools (MOTIS `Mode` values, street modes excluded). */
val TRANSIT_MODES: List<String> =
    listOf(
        "TRANSIT", "TRAM", "SUBWAY", "FERRY", "AIRPLANE", "BUS", "COACH", "RAIL", "HIGHSPEED_RAIL", "LONG_DISTANCE",
        "NIGHT_RAIL", "REGIONAL_FAST_RAIL", "REGIONAL_RAIL", "SUBURBAN", "FUNICULAR", "AERIAL_LIFT", "OTHER",
    )

/** Result of a tool: a short text for the model, and structured data for the view. */
class ToolOutput(val text: String, val structured: JsonObject? = null) {
    companion object {
        fun <T> of(text: String, serializer: KSerializer<T>, value: T): ToolOutput =
            ToolOutput(text, dtoJson.encodeToJsonElement(serializer, value).jsonObject)
    }
}

/** JSON schema of the tool arguments. */
class SchemaBuilder {
    private val properties = mutableMapOf<String, JsonObject>()
    private val required = mutableListOf<String>()

    private fun property(name: String, type: String, description: String, required: Boolean, extra: JsonObjectBuilder.() -> Unit = {}) {
        properties[name] =
            buildJsonObject {
                put("type", type)
                put("description", description)
                extra()
            }
        if (required) this.required += name
    }

    fun string(name: String, description: String, required: Boolean = false, enum: List<String>? = null) =
        property(name, "string", description, required) {
            enum?.let { values -> putJsonArray("enum") { values.forEach { add(it) } } }
        }

    fun number(name: String, description: String, required: Boolean = false) = property(name, "number", description, required)

    fun integer(name: String, description: String, required: Boolean = false, minimum: Int? = null, maximum: Int? = null) =
        property(name, "integer", description, required) {
            minimum?.let { put("minimum", it) }
            maximum?.let { put("maximum", it) }
        }

    fun boolean(name: String, description: String, required: Boolean = false) = property(name, "boolean", description, required)

    fun stringArray(name: String, description: String, enum: List<String>? = null) =
        property(name, "array", description, required = false) {
            putJsonObject("items") {
                put("type", "string")
                enum?.let { values -> putJsonArray("enum") { values.forEach { add(it) } } }
            }
        }

    fun build(): ToolSchema = ToolSchema(properties = JsonObject(properties), required = required.ifEmpty { null })
}

/** Typed access to the tool arguments. Invalid values are reported to the caller. */
class Args(private val arguments: JsonObject) {
    private fun primitive(name: String): JsonPrimitive? =
        (arguments[name] as? JsonPrimitive)?.takeUnless { it.contentOrNull.isNullOrBlank() }

    fun string(name: String): String? = primitive(name)?.contentOrNull?.trim()

    fun requireString(name: String): String = string(name) ?: invalid("'$name' is required")

    fun double(name: String): Double? =
        primitive(name)?.let { it.doubleOrNull ?: it.contentOrNull?.toDoubleOrNull() ?: invalid("'$name' must be a number") }

    fun int(name: String): Int? =
        primitive(name)?.let { it.intOrNull ?: it.contentOrNull?.toIntOrNull() ?: invalid("'$name' must be an integer") }

    fun long(name: String): Long? =
        primitive(name)?.let { it.longOrNull ?: it.contentOrNull?.toLongOrNull() ?: invalid("'$name' must be an integer") }

    fun boolean(name: String): Boolean? =
        primitive(name)?.let { it.booleanOrNull ?: it.contentOrNull?.toBooleanStrictOrNull() ?: invalid("'$name' must be a boolean") }

    fun stringList(name: String): List<String>? =
        when (val value = arguments[name]) {
            null -> null
            is JsonArray -> value.mapNotNull { (it as? JsonPrimitive)?.contentOrNull?.trim() }.filter { it.isNotEmpty() }
            is JsonPrimitive -> value.contentOrNull?.split(',')?.map { it.trim() }?.filter { it.isNotEmpty() }
            else -> invalid("'$name' must be an array of strings")
        }?.ifEmpty { null }

    /** ISO-8601 instant (`2026-10-09T08:00:00Z` or with offset). */
    fun instant(name: String): Instant? =
        string(name)?.let {
            runCatching { Instant.parse(it) }.getOrElse { _ -> invalid("'$name' must be an ISO-8601 date-time with offset, e.g. 2026-10-09T08:00:00+02:00") }
        }

    /** Value of an enum argument, case-insensitive. */
    inline fun <reified E : Enum<E>> enum(name: String): E? =
        string(name)?.let { value ->
            enumValues<E>().firstOrNull { it.name.equals(value, ignoreCase = true) }
                ?: invalid("'$name' must be one of ${enumValues<E>().joinToString { it.name }}")
        }

    fun modes(name: String): List<Mode>? =
        stringList(name)?.map { value ->
            Mode.entries.firstOrNull { it != Mode.UNKNOWN_ && it.serialName().equals(value, ignoreCase = true) }
                ?: invalid("unknown mode '$value' (expected one of ${TRANSIT_MODES.joinToString()})")
        }

    @PublishedApi
    internal fun invalid(message: String): Nothing = throw MotisToolException("Invalid argument: $message")
}

/**
 * Registers a read-only tool calling the MOTIS API, optionally rendered by [view].
 * [MotisToolException]s are returned as tool errors (`isError = true`).
 */
fun Server.motisTool(
    name: String,
    title: String,
    description: String,
    view: UiView? = null,
    visibility: List<ToolVisibility>? = null,
    schema: SchemaBuilder.() -> Unit = {},
    handler: suspend (Args) -> ToolOutput,
) {
    addTool(
        Tool(
            name = name,
            title = title,
            description = description,
            inputSchema = SchemaBuilder().apply(schema).build(),
            annotations = ToolAnnotations(title = title, readOnlyHint = true, destructiveHint = false, openWorldHint = true),
            meta = view?.toolMeta(visibility),
        ),
    ) { request ->
        try {
            val output = handler(Args(request.arguments ?: JsonObject(emptyMap())))
            CallToolResult(content = listOf(TextContent(output.text)), structuredContent = output.structured)
        } catch (e: MotisToolException) {
            logger.info { "Tool $name failed: ${e.message}" }
            CallToolResult(content = listOf(TextContent(e.message ?: "error")), isError = true)
        }
    }
}

private val TIME_FORMAT = java.time.format.DateTimeFormatter.ofPattern("HH:mm")

/** `HH:mm` of an ISO instant, in the [tz] time zone of the place (UTC when unknown). */
fun hhmm(iso: String?, tz: String?): String =
    iso?.let {
        val zone = runCatching { java.time.ZoneId.of(tz) }.getOrDefault(java.time.ZoneOffset.UTC)
        java.time.Instant.parse(it).atZone(zone).format(TIME_FORMAT)
    } ?: "--:--"
