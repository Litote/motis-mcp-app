package org.litote.motis.mcp.tools

import io.github.oshai.kotlinlogging.KotlinLogging
import io.modelcontextprotocol.kotlin.sdk.server.Server
import io.modelcontextprotocol.kotlin.sdk.types.CallToolResult
import io.modelcontextprotocol.kotlin.sdk.types.TextContent
import io.modelcontextprotocol.kotlin.sdk.types.Tool
import io.modelcontextprotocol.kotlin.sdk.types.ToolAnnotations
import io.modelcontextprotocol.kotlin.sdk.types.ToolSchema
import kotlinx.coroutines.CancellationException
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

/**
 * MOTIS modes that are not transit: street and on-demand modes, debug routes, the misspelled alias of `AERIAL_LIFT`.
 * The other modes are transit: those added by MOTIS are accepted without a change here.
 */
private val NON_TRANSIT_MODES =
    setOf(
        Mode.WALK, Mode.BIKE, Mode.RENTAL, Mode.CAR, Mode.CAR_PARKING, Mode.CAR_DROPOFF, Mode.ODM, Mode.RIDE_SHARING,
        Mode.FLEX, Mode.DEBUG_BUS_ROUTE, Mode.DEBUG_RAILWAY_ROUTE, Mode.DEBUG_FERRY_ROUTE, Mode.AREAL_LIFT, Mode.UNKNOWN_,
    )

private val TRANSIT_MODE_VALUES: List<Mode> = Mode.entries - NON_TRANSIT_MODES

/** Transit modes accepted by the tools (MOTIS `Mode` values). */
val TRANSIT_MODES: List<String> = TRANSIT_MODE_VALUES.map { it.serialName() }

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

    /** Bounds of the integer arguments: the SDK does not validate the arguments against the schema, [Args] does. */
    val bounds = mutableMapOf<String, LongRange>()

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

    fun integer(name: String, description: String, required: Boolean = false, minimum: Int? = null, maximum: Int? = null) {
        property(name, "integer", description, required) {
            minimum?.let { put("minimum", it) }
            maximum?.let { put("maximum", it) }
        }
        if (minimum != null || maximum != null) {
            bounds[name] = (minimum?.toLong() ?: Long.MIN_VALUE)..(maximum?.toLong() ?: Long.MAX_VALUE)
        }
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

/** Typed access to the tool arguments. Invalid values, out of their [bounds] included, are reported to the caller. */
class Args(private val arguments: JsonObject, private val bounds: Map<String, LongRange> = emptyMap()) {
    private fun primitive(name: String): JsonPrimitive? =
        (arguments[name] as? JsonPrimitive)?.takeUnless { it.contentOrNull.isNullOrBlank() }

    fun string(name: String): String? = primitive(name)?.contentOrNull?.trim()

    fun requireString(name: String): String = string(name) ?: invalid("'$name' is required")

    fun double(name: String): Double? =
        primitive(name)?.let { it.doubleOrNull ?: it.contentOrNull?.toDoubleOrNull() ?: invalid("'$name' must be a number") }

    fun int(name: String): Int? = long(name)?.let { if (it in Int.MIN_VALUE..Int.MAX_VALUE) it.toInt() else outOfBounds(name) }

    fun long(name: String): Long? =
        primitive(name)
            ?.let { it.longOrNull ?: it.contentOrNull?.toLongOrNull() ?: invalid("'$name' must be an integer") }
            ?.also { value -> bounds[name]?.let { if (value !in it) outOfBounds(name) } }

    private fun outOfBounds(name: String): Nothing {
        val range = bounds[name]
        invalid(
            when {
                range == null -> "'$name' is out of range"
                range.last == Long.MAX_VALUE -> "'$name' must be at least ${range.first}"
                range.first == Long.MIN_VALUE -> "'$name' must be at most ${range.last}"
                else -> "'$name' must be between ${range.first} and ${range.last}"
            },
        )
    }

    fun boolean(name: String): Boolean? =
        primitive(name)?.let { it.booleanOrNull ?: it.contentOrNull?.toBooleanStrictOrNull() ?: invalid("'$name' must be a boolean") }

    fun stringList(name: String): List<String>? =
        when (val value = arguments[name]) {
            null -> null
            is JsonArray -> value.mapNotNull { (it as? JsonPrimitive)?.contentOrNull?.trim() }.filter { it.isNotEmpty() }
            is JsonPrimitive -> value.contentOrNull?.split(',')?.map { it.trim() }?.filter { it.isNotEmpty() }
            else -> invalid("'$name' must be an array of strings")
        }?.ifEmpty { null }

    /**
     * ISO-8601 date-time: an instant (`2026-10-09T08:00:00Z` or with offset), or a local date-time (`2026-10-09T08:00`)
     * in the time zone given by [zone]. The models often omit the offset: [zone] is only called then (it may call MOTIS).
     */
    suspend fun instant(name: String, zone: suspend () -> String?): Instant? {
        val value = string(name) ?: return null
        runCatching { Instant.parse(value) }.getOrNull()?.let { return it }
        val local =
            runCatching { java.time.LocalDateTime.parse(value.replace(' ', 'T')) }.getOrNull()
                ?: invalid("'$name' must be an ISO-8601 date-time, e.g. 2026-10-09T08:00:00+02:00")
        val tz =
            zone()?.let { runCatching { java.time.ZoneId.of(it) }.getOrNull() }
                ?: invalid("'$name' has no UTC offset and the time zone of the place is unknown: add the offset, e.g. 2026-10-09T08:00:00+02:00")
        val instant = local.atZone(tz).toInstant()
        return Instant.fromEpochSeconds(instant.epochSecond, instant.nano)
    }

    /** Value of an enum argument, case-insensitive. */
    inline fun <reified E : Enum<E>> enum(name: String): E? =
        string(name)?.let { value ->
            enumValues<E>().firstOrNull { it.name.equals(value, ignoreCase = true) }
                ?: invalid("'$name' must be one of ${enumValues<E>().joinToString { it.name }}")
        }

    fun modes(name: String): List<Mode>? =
        stringList(name)?.map { value ->
            TRANSIT_MODE_VALUES.firstOrNull { it.serialName().equals(value, ignoreCase = true) }
                ?: invalid("unknown mode '$value' (expected one of ${TRANSIT_MODES.joinToString()})")
        }

    @PublishedApi
    internal fun invalid(message: String): Nothing = throw MotisToolException("Invalid argument: $message")
}

/**
 * Registers a read-only tool calling the MOTIS API, optionally rendered by [view].
 * [MotisToolException]s are returned as tool errors (`isError = true`), the other exceptions as a generic tool error.
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
    val schemaBuilder = SchemaBuilder().apply(schema)
    addTool(
        Tool(
            name = name,
            title = title,
            description = description,
            inputSchema = schemaBuilder.build(),
            annotations = ToolAnnotations(title = title, readOnlyHint = true, destructiveHint = false, openWorldHint = true),
            meta = view?.toolMeta(visibility),
        ),
    ) { request ->
        try {
            val output = handler(Args(request.arguments ?: JsonObject(emptyMap()), schemaBuilder.bounds))
            CallToolResult(content = listOf(TextContent(output.text)), structuredContent = output.structured)
        } catch (e: MotisToolException) {
            logger.info { "Tool $name failed: ${e.message}" }
            CallToolResult(content = listOf(TextContent(e.message ?: "error")), isError = true)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // a bug or an unexpected MOTIS answer: logged with its stack trace, its details are not given to the caller
            logger.error(e) { "Tool $name failed unexpectedly" }
            CallToolResult(content = listOf(TextContent("Internal error of the tool $name")), isError = true)
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
