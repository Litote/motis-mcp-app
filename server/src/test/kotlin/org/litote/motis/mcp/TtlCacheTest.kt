package org.litote.motis.mcp

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.time.Duration.Companion.minutes
import kotlin.time.TestTimeSource

class TtlCacheTest {
    private val time = TestTimeSource()
    private var loads = 0

    private suspend fun TtlCache<String, String>.get(key: String): String = getOrPut(key) { "$key${++loads}" }

    @Test
    fun `values are kept until they expire`() =
        runBlocking {
            val cache = TtlCache<String, String>(maxSize = 10, ttl = 5.minutes, time)

            assertEquals("a1", cache.get("a"))
            time += 4.minutes
            assertEquals("a1", cache.get("a"))
            time += 1.minutes
            assertEquals("a2", cache.get("a"))
        }

    @Test
    fun `the least recently used value is evicted`() =
        runBlocking {
            val cache = TtlCache<String, String>(maxSize = 2, ttl = 5.minutes, time)

            cache.get("a")
            cache.get("b")
            cache.get("a")
            cache.get("c")

            assertEquals("a1", cache.get("a"))
            assertEquals("b4", cache.get("b"))
        }

    @Test
    fun `failures are not cached`() =
        runBlocking {
            val cache = TtlCache<String, String>(maxSize = 10, ttl = 5.minutes, time)

            assertFailsWith<MotisToolException> { cache.getOrPut("a") { throw MotisToolException("down") } }
            assertEquals("a1", cache.get("a"))
        }

    @Test
    fun `concurrent misses share a single load`() =
        runBlocking {
            val cache = TtlCache<String, String>(maxSize = 10, ttl = 5.minutes, time)
            val gate = CompletableDeferred<Unit>()

            val values =
                List(3) {
                    async {
                        cache.getOrPut("a") {
                            gate.await()
                            "a${++loads}"
                        }
                    }
                }
            yield()
            gate.complete(Unit)

            assertEquals(listOf("a1", "a1", "a1"), values.awaitAll())
            assertEquals(1, loads)
        }

    @Test
    fun `a cancelled load is retried by the other callers`() =
        runBlocking {
            val cache = TtlCache<String, String>(maxSize = 10, ttl = 5.minutes, time)
            val started = CompletableDeferred<Unit>()

            val first = async { cache.getOrPut("a") { started.complete(Unit); CompletableDeferred<String>().await() } }
            started.await()
            val second = async { cache.get("a") }
            yield()
            first.cancel()

            assertEquals("a1", second.await())
        }
}
