@file:OptIn(ExperimentalSerializationApi::class)

package org.litote.motis.mcp.realtime

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.Json
import kotlinx.serialization.protobuf.ProtoBuf
import org.litote.motis.client.client.TimetableClient
import org.litote.motis.client.model.StopTime
import org.litote.motis.mcp.MockMotis
import org.litote.motis.mcp.MotisGateway
import org.litote.motis.mcp.MotisMcpConfig
import org.litote.motis.mcp.StopTimesQuery
import org.litote.motis.mcp.dto.toDto
import org.litote.motis.mcp.respondJson
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds
import kotlin.time.Instant
import kotlin.time.TestTimeSource

class SncfRealtimeOverlayTest {
    private val time = TestTimeSource()
    private var feedRequests = 0

    /** Departures of Lyon Part Dieu recorded from Transitous, without real time for the SNCF, and the SNCF feed then. */
    private val stopTimesJson = resource("/realtime/stoptimes-sncf.json").decodeToString()
    private val stopTimes =
        Json { ignoreUnknownKeys = true }.decodeFromString<TimetableClient.StoptimesResponseBody>(stopTimesJson).stopTimes
    private val recordedFeed = resource("/realtime/sncf-trip-updates.pb")

    private fun resource(path: String): ByteArray = SncfRealtimeOverlayTest::class.java.getResource(path)!!.readBytes()

    private fun overlay(answer: () -> ByteArray?): SncfRealtimeOverlay =
        SncfRealtimeOverlay(
            HttpClient(
                MockEngine { request ->
                    feedRequests++
                    assertEquals("tests", request.headers[HttpHeaders.UserAgent])
                    answer()?.let { respond(it) } ?: respond("", HttpStatusCode.ServiceUnavailable)
                },
            ),
            userAgent = "tests",
            timeSource = time,
        )

    /** Feed with the trip of [stopTime], [delay] at its stop and the next ones. */
    private fun feedOf(
        stopTime: StopTime,
        delay: Long,
        tripId: String = "OCESN${stopTime.tripShortName}F1187_F:TER:FR:Line::X:20261212",
        cancelled: Boolean = false,
        skipped: Boolean = false,
    ): FeedEntity {
        fun event(scheduled: Instant?) = scheduled?.let { StopTimeEvent(delay = delay, time = it.epochSeconds + delay) }
        val updates =
            listOf(
                StopTimeUpdate(
                    departure = event(stopTime.place.scheduledDeparture),
                    scheduleRelationship = if (skipped) StopTimeUpdate.SKIPPED else StopTimeUpdate.SCHEDULED,
                ),
            ) + stopTime.nextStops.orEmpty().map { StopTimeUpdate(arrival = event(it.scheduledArrival)) }
        return FeedEntity(
            id = tripId,
            tripUpdate =
                TripUpdate(
                    TripDescriptor(tripId, "20261031", if (cancelled) TripDescriptor.CANCELED else TripDescriptor.SCHEDULED),
                    updates,
                ),
        )
    }

    private fun encode(vararg entities: FeedEntity): ByteArray =
        ProtoBuf.encodeToByteArray(FeedMessage.serializer(), FeedMessage(FeedHeader(timestamp = 1793437000), entities.toList()))

    @Test
    fun `the recorded SNCF feed gives the real time of the SNCF trains of the recorded departures`() =
        runBlocking {
            val patched = overlay { recordedFeed }.patch(stopTimes)

            val sncf = stopTimes.withIndex().filter { (_, st) -> st.tripId.contains("_fr-horaires-sncf_") }
            assertEquals(11, sncf.size)
            assertEquals(sncf.map { it.index }.toSet(), patched.keys)
            patched.values.forEach { st ->
                assertTrue(st.realTime)
                assertTrue(st.place.departure != null && st.nextStops!!.all { it.arrival != null })
            }
            // the regional train of another feed of Transitous already has its real time
            assertFalse(stopTimes.indexOfFirst { it.tripShortName == "886173" } in patched)
        }

    @Test
    fun `delays are applied to the stop and the next stops`() =
        runBlocking {
            val st = stopTimes.first()
            val patched = overlay { encode(feedOf(st, delay = 600)) }.patch(listOf(st)).getValue(0)

            assertTrue(patched.realTime)
            assertEquals(st.place.scheduledDeparture!! + 10.minutes, patched.place.departure)
            assertEquals(st.nextStops!!.map { it.scheduledArrival!! + 10.minutes }, patched.nextStops!!.map { it.arrival })
            assertFalse(patched.cancelled || patched.tripCancelled)
        }

    @Test
    fun `cancelled trips and skipped stops are cancelled`() =
        runBlocking {
            val (first, second) = stopTimes.filter { !it.realTime }
            val patched = overlay { encode(feedOf(first, 0, cancelled = true), feedOf(second, 0, skipped = true)) }.patch(listOf(first, second))

            assertTrue(patched.getValue(0).tripCancelled)
            assertTrue(patched.getValue(1).cancelled)
        }

    @Test
    fun `a stop time matching several trips is left as it is`() =
        runBlocking {
            val st = stopTimes.first()
            val feed = encode(feedOf(st, 0, tripId = "OCESN${st.tripShortName}F1187_A"), feedOf(st, 300, tripId = "OCESN0${st.tripShortName}F1187_B"))

            assertEquals(emptyMap(), overlay { feed }.patch(listOf(st)))
        }

    @Test
    fun `a stop time at another scheduled time is left as it is`() =
        runBlocking {
            val st = stopTimes.first()
            val other = st.copy(place = st.place.copy(scheduledDeparture = st.place.scheduledDeparture!! + 1.minutes))

            assertEquals(emptyMap(), overlay { encode(feedOf(st, 0)) }.patch(listOf(other)))
        }

    @Test
    fun `the feed is not downloaded without SNCF stop times lacking real time`() =
        runBlocking {
            val overlay = overlay { recordedFeed }
            val st = stopTimes.first()

            assertEquals(emptyMap(), overlay.patch(listOf(st.copy(realTime = true), stopTimes.first { it.tripShortName == "886173" })))
            assertEquals(0, feedRequests)
        }

    @Test
    fun `the feed is downloaded once a minute`() =
        runBlocking {
            val overlay = overlay { recordedFeed }

            overlay.patch(stopTimes)
            time += 59.seconds
            overlay.patch(stopTimes)
            assertEquals(1, feedRequests)
            time += 1.seconds
            overlay.patch(stopTimes)
            assertEquals(2, feedRequests)
        }

    @Test
    fun `an unavailable feed disables the overlay five minutes`() =
        runBlocking {
            var feed: ByteArray? = null
            val overlay = overlay { feed }

            assertEquals(emptyMap(), overlay.patch(stopTimes))
            feed = recordedFeed
            time += 4.minutes
            assertEquals(emptyMap(), overlay.patch(stopTimes))
            assertEquals(1, feedRequests)
            time += 1.minutes
            assertEquals(11, overlay.patch(stopTimes).size)
        }

    @Test
    fun `an invalid feed disables the overlay`() =
        runBlocking {
            assertEquals(emptyMap(), overlay { "<html>maintenance</html>".encodeToByteArray() }.patch(stopTimes))
        }

    @Test
    fun `the departures of the gateway tell the source of their real time`() =
        runBlocking {
            val motis = MockMotis { respondJson(stopTimesJson) }
            val config = MotisMcpConfig(contact = "https://example.org/tests")
            val gateway = MotisGateway(config.clientConfiguration(motis.engine), overlays = listOf(overlay { recordedFeed }))

            val departures = gateway.stopTimes(StopTimesQuery(stopId = stopTimes.first().place.stopId!!)).toDto(arriveBy = false)

            val (overlaid, motisOnly) = departures.stopTimes.partition { it.realTimeSource != null }
            assertEquals(11, overlaid.size)
            assertTrue(overlaid.all { it.realTime && it.realTimeSource == "SNCF GTFS-RT" })
            assertNull(motisOnly.single().realTimeSource)
            assertTrue(motisOnly.single().realTime)
        }
}
