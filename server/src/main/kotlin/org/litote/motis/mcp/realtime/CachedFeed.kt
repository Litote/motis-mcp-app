package org.litote.motis.mcp.realtime

import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import org.litote.motis.mcp.TtlCache
import kotlin.time.Duration
import kotlin.time.Duration.Companion.minutes
import kotlin.time.TimeMark
import kotlin.time.TimeSource

private val logger = KotlinLogging.logger {}

/**
 * Feed loaded at most once a [ttl]. When it fails or does not load within [timeout], it is not used for [retryDelay]:
 * [get] returns null.
 */
internal class CachedFeed<T : Any>(
    private val name: String,
    ttl: Duration,
    private val timeout: Duration,
    private val timeSource: TimeSource,
    private val retryDelay: Duration = 5.minutes,
    private val load: suspend () -> T,
) {
    private val cache = TtlCache<Unit, T>(maxSize = 1, ttl = ttl, timeSource)

    @Volatile
    private var disabledUntil: TimeMark? = null

    suspend fun get(): T? {
        if (disabledUntil?.hasNotPassedNow() == true) return null
        return try {
            cache.getOrPut(Unit) { withTimeout(timeout) { load() } }
        } catch (e: TimeoutCancellationException) {
            disable("no answer within $timeout")
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            disable(e.toString())
        }
    }

    private fun disable(reason: String): Nothing? {
        logger.warn { "$name unavailable ($reason): disabled for $retryDelay" }
        disabledUntil = timeSource.markNow() + retryDelay
        return null
    }
}
