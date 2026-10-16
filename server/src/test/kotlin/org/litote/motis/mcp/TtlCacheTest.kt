package org.litote.motis.mcp

import kotlinx.coroutines.runBlocking
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
}
