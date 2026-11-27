package org.litote.motis.mcp.lambda

import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import java.net.InetAddress
import java.security.MessageDigest
import java.security.SecureRandom
import kotlin.io.encoding.Base64

private val logger by lazy { KotlinLogging.logger("org.litote.motis.mcp.lambda.RequestGuard") }

/** Secret sent by CloudFront to the function URL in [ORIGIN_SECRET_HEADER]: when set, the other requests are rejected. */
internal const val ORIGIN_SECRET_ENV = "MOTIS_ORIGIN_SECRET"

/** Tool calls a minute of a client (IPv4 address, IPv6 /64) on one Lambda instance; 0 or not set: no limit. */
internal const val RATE_LIMIT_ENV = "MOTIS_RATE_LIMIT_PER_MINUTE"

/** Custom origin header of the CloudFront distribution (infra/web.tf). */
internal const val ORIGIN_SECRET_HEADER = "x-origin-verify"

/** Address of the viewer added by CloudFront (`<ip>:<port>`), forwarded by the origin request policy. */
internal const val VIEWER_ADDRESS_HEADER = "cloudfront-viewer-address"

/** Markers of the log lines counted by the CloudWatch metric filters of the alarms (infra/alerts.tf). */
internal const val ORIGIN_REJECTED_MARKER = "ORIGIN_REJECTED"
internal const val RATE_LIMITED_MARKER = "RATE_LIMITED"

private const val WINDOW_MILLIS = 60_000L

/** Clients tracked in a window: beyond, new clients are not limited (bounded memory). */
private const val MAX_CLIENTS = 10_000

/**
 * Checks a request before the MCP server, at the lowest cost (no MOTIS call):
 * - with an [originSecret], the requests that do not come through CloudFront (the function URL called directly) are
 *   rejected (403);
 * - with a [toolCallsPerMinute] limit, the tool calls of a client above it are answered by a tool error, so that the
 *   assistant can tell the user to retry. The other requests (initialize, tools/list…) are not limited.
 *
 * The counters are in memory, per Lambda instance: as the requests of a client are spread over the instances, the
 * effective limit is between 1 and [the reserved concurrency] times [toolCallsPerMinute], and a cold start resets them.
 * A rejection is logged once per minute (origin) or once per client and per minute (rate limit), with a marker counted
 * by an alarm: no IP address is logged, only a pseudonym of the client (a hash, salted with the secret).
 */
internal class RequestGuard(
    originSecret: String?,
    private val toolCallsPerMinute: Int,
    private val clock: () -> Long = System::currentTimeMillis,
    private val log: (String) -> Unit = { message -> logger.warn { message } },
) {
    private val secret: ByteArray? = originSecret?.takeIf { it.isNotEmpty() }?.encodeToByteArray()

    // pseudonyms stable across the instances when the secret is set
    private val salt: ByteArray = secret ?: ByteArray(32).also { SecureRandom().nextBytes(it) }

    private var window = -1L
    private val toolCalls = HashMap<String, Int>()

    private var originRejected = 0
    private var originLoggedAt: Long? = null

    private var viewerAddressMissingLogged = false

    init {
        require(toolCallsPerMinute >= 0) { "$RATE_LIMIT_ENV must be positive or 0: $toolCallsPerMinute" }
    }

    /** The response to the rejected [event], or null when it can be handled. */
    @Synchronized
    fun check(event: FunctionUrlEvent): FunctionUrlResponse? =
        when {
            !fromOrigin(event) -> rejectOrigin()
            toolCallsPerMinute > 0 -> limitToolCalls(event)
            else -> null
        }

    private fun fromOrigin(event: FunctionUrlEvent): Boolean =
        secret == null ||
            event.header(ORIGIN_SECRET_HEADER)?.let { MessageDigest.isEqual(it.encodeToByteArray(), secret) } == true

    private fun rejectOrigin(): FunctionUrlResponse {
        originRejected++
        val now = clock()
        if (originLoggedAt.let { it == null || now - it >= WINDOW_MILLIS }) {
            log("$ORIGIN_REJECTED_MARKER: $originRejected request(s) without the origin header of CloudFront (function URL called directly)")
            originRejected = 0
            originLoggedAt = now
        }
        return FunctionUrlResponse(statusCode = 403, headers = mapOf("content-type" to "text/plain"), body = "Forbidden")
    }

    private fun limitToolCalls(event: FunctionUrlEvent): FunctionUrlResponse? {
        val request = toolCall(event) ?: return null
        val client = clientKey(event) ?: return null
        val now = clock()
        val current = now / WINDOW_MILLIS
        if (current != window) {
            window = current
            toolCalls.clear()
        }
        if (client !in toolCalls && toolCalls.size >= MAX_CLIENTS) return null
        val count = toolCalls.merge(client, 1, Int::plus)!!
        if (count <= toolCallsPerMinute) return null
        if (count == toolCallsPerMinute + 1) {
            log("$RATE_LIMITED_MARKER: client ${pseudonym(client)} above $toolCallsPerMinute tool calls a minute")
        }
        val retryAfter = ((current + 1) * WINDOW_MILLIS - now + 999) / 1000
        return rateLimited(request["id"] ?: JsonNull, retryAfter)
    }

    /** The JSON-RPC request of a tool call, or null (another method, or a body the MCP server will reject). */
    private fun toolCall(event: FunctionUrlEvent): JsonObject? {
        val body = event.body ?: return null
        return runCatching {
            val text = if (event.base64Encoded) Base64.decode(body).decodeToString() else body
            lambdaJson.parseToJsonElement(text) as? JsonObject
        }.getOrNull()?.takeIf { (it["method"] as? JsonPrimitive)?.content == "tools/call" }
    }

    /** The client: its IPv4 address, or the /64 network of its IPv6 address (one per subscriber). */
    private fun clientKey(event: FunctionUrlEvent): String? {
        val viewer = event.header(VIEWER_ADDRESS_HEADER)?.substringBeforeLast(':')
        if (viewer == null && secret != null && !viewerAddressMissingLogged) {
            viewerAddressMissingLogged = true
            log("No $VIEWER_ADDRESS_HEADER header: the rate limit applies to the source IP (CloudFront), check the origin request policy")
        }
        val ip = (viewer ?: event.requestContext.http.sourceIp)?.removeSurrounding("[", "]") ?: return null
        val bytes = runCatching { InetAddress.ofLiteral(ip).address }.getOrNull() ?: return ip
        return if (bytes.size == 16) "${bytes.copyOf(8).toHexString()}/64" else ip
    }

    private fun pseudonym(client: String): String =
        MessageDigest.getInstance("SHA-256").run {
            update(salt)
            digest(client.encodeToByteArray())
        }.copyOf(6).toHexString()

    private fun rateLimited(id: JsonElement, retryAfter: Long): FunctionUrlResponse {
        val message =
            "Rate limit of the server reached ($toolCallsPerMinute tool calls a minute): retry in $retryAfter seconds"
        val body =
            buildJsonObject {
                put("jsonrpc", "2.0")
                put("id", id)
                putJsonObject("result") {
                    putJsonArray("content") {
                        addJsonObject {
                            put("type", "text")
                            put("text", message)
                        }
                    }
                    put("isError", true)
                }
            }
        return FunctionUrlResponse(
            statusCode = 200,
            headers = mapOf("content-type" to "application/json", "retry-after" to retryAfter.toString()),
            body = body.toString(),
        )
    }

    companion object {
        /** Guard configured from the environment (see [ORIGIN_SECRET_ENV] and [RATE_LIMIT_ENV]). */
        fun fromEnv(env: Map<String, String>): RequestGuard {
            val limit =
                env[RATE_LIMIT_ENV]?.trim()?.takeIf { it.isNotEmpty() }?.let {
                    requireNotNull(it.toIntOrNull()) { "$RATE_LIMIT_ENV must be an integer: \"$it\"" }
                } ?: 0
            return RequestGuard(env[ORIGIN_SECRET_ENV], limit)
        }
    }
}
