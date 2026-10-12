package org.litote.motis.mcp.lambda

import io.ktor.http.Headers
import io.ktor.http.HeadersBuilder
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.Parameters
import io.ktor.http.RequestConnectionPoint
import io.ktor.http.URLProtocol
import io.ktor.http.content.OutgoingContent
import io.ktor.http.parseQueryString
import io.ktor.server.application.Application
import io.ktor.server.application.PipelineCall
import io.ktor.server.engine.BaseApplicationCall
import io.ktor.server.engine.BaseApplicationRequest
import io.ktor.server.engine.BaseApplicationResponse
import io.ktor.server.request.RequestCookies
import io.ktor.server.response.ResponseHeaders
import io.ktor.utils.io.ByteChannel
import io.ktor.utils.io.ByteReadChannel
import io.ktor.utils.io.ByteWriteChannel
import kotlinx.coroutines.CoroutineScope
import kotlin.coroutines.CoroutineContext
import kotlin.io.encoding.Base64

/** Ktor call built from a single function URL event. */
internal class LambdaApplicationCall(
    application: Application,
    event: FunctionUrlEvent,
    override val coroutineContext: CoroutineContext,
) : BaseApplicationCall(application),
    CoroutineScope {
    override val request: LambdaApplicationRequest = LambdaApplicationRequest(this, event)
    override val response: LambdaApplicationResponse = LambdaApplicationResponse(this)

    init {
        putResponseAttribute()
    }
}

internal class LambdaApplicationRequest(call: PipelineCall, event: FunctionUrlEvent) : BaseApplicationRequest(call) {
    override val cookies: RequestCookies by lazy { RequestCookies(this) }

    override val engineHeaders: Headers =
        HeadersBuilder().apply { event.headers.forEach { (name, value) -> append(name, value) } }.build()

    override val engineReceiveChannel: ByteReadChannel =
        when (val body = event.body) {
            null -> ByteReadChannel.Empty
            else -> ByteReadChannel(if (event.base64Encoded) Base64.decode(body) else body.encodeToByteArray())
        }

    override val queryParameters: Parameters = parseQueryString(event.rawQueryString)

    override val rawQueryParameters: Parameters = parseQueryString(event.rawQueryString, decode = false)

    override val local: RequestConnectionPoint =
        LambdaConnectionPoint(
            uri = if (event.rawQueryString.isEmpty()) event.rawPath else "${event.rawPath}?${event.rawQueryString}",
            method = HttpMethod.parse(event.requestContext.http.method),
            hostHeader = event.header("host"),
        )
}

/** Captures status, headers and body in memory: [LambdaEngine] turns them into a [FunctionUrlResponse]. */
internal class LambdaApplicationResponse(call: PipelineCall) : BaseApplicationResponse(call) {
    @Volatile
    var capturedStatus: HttpStatusCode = HttpStatusCode.OK
        private set

    val capturedHeaders: HeadersBuilder = HeadersBuilder()

    val capturedBody: ByteChannel = ByteChannel(autoFlush = true)

    override val headers: ResponseHeaders =
        object : ResponseHeaders() {
            override fun engineAppendHeader(name: String, value: String) {
                capturedHeaders.append(name, value)
            }

            override fun getEngineHeaderNames(): List<String> = capturedHeaders.names().toList()

            override fun getEngineHeaderValues(name: String): List<String> = capturedHeaders.getAll(name).orEmpty()
        }

    override fun setStatus(statusCode: HttpStatusCode) {
        capturedStatus = statusCode
    }

    override suspend fun responseChannel(): ByteWriteChannel = capturedBody

    override suspend fun respondUpgrade(upgrade: OutgoingContent.ProtocolUpgrade): Unit =
        throw UnsupportedOperationException("Protocol upgrade is not supported on Lambda")
}

/** Connection point of a synthetic request: only the fields read by the routing and the DNS rebinding check are meaningful. */
internal class LambdaConnectionPoint(
    override val uri: String,
    override val method: HttpMethod,
    private val hostHeader: String?,
) : RequestConnectionPoint {
    override val scheme: String = "https"
    override val version: String = "HTTP/1.1"

    @Deprecated("Use localHost or serverHost instead")
    override val host: String
        get() = serverHost

    @Deprecated("Use localPort or serverPort instead")
    override val port: Int
        get() = serverPort

    override val localPort: Int = URLProtocol.HTTPS.defaultPort
    override val serverPort: Int = URLProtocol.HTTPS.defaultPort
    override val localHost: String = "lambda"
    override val serverHost: String = hostHeader?.substringBefore(":") ?: "lambda"
    override val localAddress: String = "lambda"
    override val remoteHost: String = "unknown"
    override val remotePort: Int = 0
    override val remoteAddress: String = "unknown"
}
