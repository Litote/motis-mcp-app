package org.litote.motis.mcp.lambda

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** Lambda payloads: unknown fields of the events are ignored, defaults of the responses are always written. */
@OptIn(ExperimentalSerializationApi::class)
internal val lambdaJson: Json =
    Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

/**
 * Request of a Lambda function URL (payload format 2.0, shared with the API Gateway HTTP API).
 *
 * @property rawQueryString still percent-encoded, without the leading `?`
 */
@Serializable
data class FunctionUrlEvent(
    val requestContext: RequestContext,
    val rawPath: String = requestContext.http.path,
    val rawQueryString: String = "",
    val headers: Map<String, String> = emptyMap(),
    val body: String? = null,
    @SerialName("isBase64Encoded") val base64Encoded: Boolean = false,
) {
    @Serializable
    data class RequestContext(val http: Http)

    @Serializable
    data class Http(val method: String, val path: String)

    fun header(name: String): String? = headers.entries.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value
}

/** Response of a Lambda function URL: [statusCode] and [headers] are always written, so that it is not taken as a raw body. */
@OptIn(ExperimentalSerializationApi::class)
@Serializable
data class FunctionUrlResponse(
    @EncodeDefault val statusCode: Int = 200,
    @EncodeDefault val headers: Map<String, String> = emptyMap(),
    val body: String? = null,
    @SerialName("isBase64Encoded") val base64Encoded: Boolean = false,
)
