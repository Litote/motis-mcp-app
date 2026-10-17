package org.litote.motis.mcp

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlin.time.Duration
import kotlin.time.TimeMark
import kotlin.time.TimeSource

/**
 * In-memory cache of the MOTIS responses that do not depend on real time, shared by the requests of a process (or
 * of a warm Lambda instance): values are kept [ttl], at most [maxSize] of them (the least recently used is evicted).
 *
 * Failures are not cached (the exception of [getOrPut] loader propagates), nor the values rejected by [keep].
 * Concurrent misses of a key share a single load, e.g. the lines of a station asked by several clients (5 MOTIS calls).
 */
internal class TtlCache<K : Any, V : Any>(
    private val maxSize: Int,
    private val ttl: Duration,
    private val timeSource: TimeSource = TimeSource.Monotonic,
    private val keep: (V) -> Boolean = { true },
) {
    private class Entry<V>(val value: V, val expiry: TimeMark)

    private val entries =
        object : LinkedHashMap<K, Entry<V>>(16, 0.75f, true) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<K, Entry<V>>): Boolean = size > maxSize
        }

    /** Loads in progress, guarded by [entries]. */
    private val loads = mutableMapOf<K, CompletableDeferred<V>>()

    suspend fun getOrPut(key: K, load: suspend () -> V): V {
        val (pending, loader) =
            synchronized(entries) {
                entries[key]?.let { if (it.expiry.hasNotPassedNow()) return it.value else entries.remove(key) }
                loads[key]?.let { it to false } ?: (CompletableDeferred<V>().also { loads[key] = it } to true)
            }
        if (!loader) {
            return try {
                pending.await()
            } catch (e: CancellationException) {
                // the loader was cancelled, not this caller: it loads the value itself
                currentCoroutineContext().ensureActive()
                getOrPut(key, load)
            }
        }
        try {
            val value = load()
            synchronized(entries) {
                if (keep(value)) entries[key] = Entry(value, timeSource.markNow() + ttl)
                loads.remove(key)
            }
            pending.complete(value)
            return value
        } catch (e: Throwable) {
            synchronized(entries) { loads.remove(key) }
            pending.completeExceptionally(e)
            throw e
        }
    }
}
