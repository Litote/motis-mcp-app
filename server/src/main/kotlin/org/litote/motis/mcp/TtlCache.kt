package org.litote.motis.mcp

import kotlin.time.Duration
import kotlin.time.TimeMark
import kotlin.time.TimeSource

/**
 * In-memory cache of the MOTIS responses that do not depend on real time, shared by the requests of a process (or
 * of a warm Lambda instance): values are kept [ttl], at most [maxSize] of them (the least recently used is evicted).
 *
 * Failures are not cached (the exception of [getOrPut] loader propagates), nor the values rejected by [keep].
 * Concurrent misses of a key both call MOTIS: simpler than coalescing them, and rare.
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

    suspend fun getOrPut(key: K, load: suspend () -> V): V {
        synchronized(entries) {
            entries[key]?.let { if (it.expiry.hasNotPassedNow()) return it.value else entries.remove(key) }
        }
        val value = load()
        if (keep(value)) synchronized(entries) { entries[key] = Entry(value, timeSource.markNow() + ttl) }
        return value
    }
}
