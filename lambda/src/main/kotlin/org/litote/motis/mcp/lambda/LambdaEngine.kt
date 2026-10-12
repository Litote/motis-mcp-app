package org.litote.motis.mcp.lambda

import io.ktor.events.Events
import io.ktor.http.ContentType
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationEnvironment
import io.ktor.server.engine.ApplicationEngine
import io.ktor.server.engine.ApplicationEngineFactory
import io.ktor.server.engine.BaseApplicationEngine
import io.ktor.util.pipeline.execute
import io.ktor.utils.io.readBuffer
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.io.readByteArray
import kotlin.io.encoding.Base64

/**
 * Ktor engine running one function URL event through the Ktor pipeline. No socket is bound: [start] and [stop] only
 * raise the lifecycle events of [BaseApplicationEngine].
 */
class LambdaEngine internal constructor(
    environment: ApplicationEnvironment,
    monitor: Events,
    developmentMode: Boolean,
    private val applicationProvider: () -> Application,
) : BaseApplicationEngine(environment, monitor, developmentMode) {
    class Configuration : BaseApplicationEngine.Configuration()

    override fun start(wait: Boolean): ApplicationEngine = this

    override fun stop(gracePeriodMillis: Long, timeoutMillis: Long) {
        // no server to release
    }

    suspend fun handle(event: FunctionUrlEvent): FunctionUrlResponse {
        val call = LambdaApplicationCall(applicationProvider(), event, currentCoroutineContext())
        pipeline.execute(call)
        call.response.capturedBody.flushAndClose()
        return call.response.toFunctionUrlResponse()
    }

    companion object Factory : ApplicationEngineFactory<LambdaEngine, Configuration> {
        override fun configuration(configure: Configuration.() -> Unit): Configuration = Configuration().apply(configure)

        override fun create(
            environment: ApplicationEnvironment,
            monitor: Events,
            developmentMode: Boolean,
            configuration: Configuration,
            applicationProvider: () -> Application,
        ): LambdaEngine = LambdaEngine(environment, monitor, developmentMode, applicationProvider)
    }
}

private suspend fun LambdaApplicationResponse.toFunctionUrlResponse(): FunctionUrlResponse {
    val bytes = capturedBody.readBuffer().readByteArray()
    val headers = capturedHeaders.entries().associate { (name, values) -> name to values.joinToString(",") }
    val text =
        headers.entries
            .firstOrNull { it.key.equals("content-type", ignoreCase = true) }
            ?.let { ContentType.parse(it.value) }
            ?.let { it.contentType == "text" || it.contentSubtype.contains("json") || it.contentSubtype.contains("javascript") }
            ?: false
    return FunctionUrlResponse(
        statusCode = capturedStatus.value,
        headers = headers,
        body = if (bytes.isEmpty()) null else if (text) bytes.decodeToString() else Base64.encode(bytes),
        base64Encoded = bytes.isNotEmpty() && !text,
    )
}
