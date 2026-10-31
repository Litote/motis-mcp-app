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

    private var tracksRequests = 0

    /** Departures recorded with the SIRI feed of the SNCF (trimmed to their trains), a few minutes later. */
    private val tracksStopTimesJson = resource("/realtime/stoptimes-sncf-tracks.json").decodeToString()
    private val tracksStopTimes =
        Json { ignoreUnknownKeys = true }.decodeFromString<TimetableClient.StoptimesResponseBody>(tracksStopTimesJson).stopTimes
    private val recordedSiri = resource("/realtime/sncf-siri-et.xml")

    /** Overlay answering [answer] for the GTFS-RT feed and [siri] for the SIRI one: null for an unavailable feed. */
    private fun overlay(siri: () -> ByteArray? = { null }, answer: () -> ByteArray?): SncfRealtimeOverlay =
        SncfRealtimeOverlay(
            HttpClient(
                MockEngine { request ->
                    assertEquals("tests", request.headers[HttpHeaders.UserAgent])
                    val body =
                        if (request.url.toString() == SncfRealtimeOverlay.TRACKS_URL) {
                            tracksRequests++
                            siri()
                        } else {
                            feedRequests++
                            answer()
                        }
                    body?.let { respond(it) } ?: respond("", HttpStatusCode.ServiceUnavailable)
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
    fun `the SNCF trains of a regional feed without real time are patched, not the trains of other operators`() =
        runBlocking {
            // TER of the ZOU ! feed (Provence), from the NeTEx of the SNCF, and a Trenitalia train
            val zou = stopTimes.first { it.tripShortName == "886173" }.copy(realTime = false)
            val trenitalia = tracksStopTimes.first { it.tripId.contains("_it-trenitalia_") }
            val feed = encode(feedOf(zou, delay = 300), feedOf(trenitalia, delay = 300))

            val patched = overlay { feed }.patch(listOf(zou, trenitalia))

            assertEquals(setOf(0), patched.keys)
            assertEquals(zou.place.scheduledDeparture!! + 5.minutes, patched.getValue(0).place.departure)
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
    fun `the recorded SIRI feed gives the tracks announced of the recorded departures`() =
        runBlocking {
            val patched = overlay(siri = { recordedSiri }) { null }.patch(tracksStopTimes)

            assertEquals(
                mapOf("895853" to "D", "12176" to "I", "5332" to "J", "18511" to "K", "889421" to "B", "886760" to "G", "893905" to "D"),
                patched.values.associate { it.tripShortName to it.place.track },
            )
            // a track does not make the times real time
            assertTrue(patched.values.none { it.realTime })
        }

    @Test
    fun `times and tracks are both applied, each feed failing alone`() =
        runBlocking {
            val st = tracksStopTimes.first()
            var siri: ByteArray? = recordedSiri
            val overlay = overlay(siri = { siri }) { encode(feedOf(st, delay = 120)) }

            val both = overlay.patch(listOf(st)).getValue(0)
            assertEquals("D", both.place.track)
            assertEquals(st.place.scheduledDeparture!! + 2.minutes, both.place.departure)

            siri = null
            time += 3.minutes
            val timesOnly = overlay.patch(listOf(st)).getValue(0)
            assertNull(timesOnly.place.track)
            assertTrue(timesOnly.realTime)
            assertEquals(2, tracksRequests)
        }

    @Test
    fun `the SIRI feed is downloaded every 3 minutes and keeps the tracks of MOTIS`() =
        runBlocking {
            val overlay = overlay(siri = { recordedSiri }) { null }
            val st = tracksStopTimes.first()

            assertEquals(emptyMap(), overlay.patch(listOf(st.copy(place = st.place.copy(scheduledTrack = "3")))))
            time += 2.minutes
            overlay.patch(tracksStopTimes)
            assertEquals(1, tracksRequests)
            time += 1.minutes
            overlay.patch(tracksStopTimes)
            assertEquals(2, tracksRequests)
        }

    @Test
    fun `the SIRI calls without aimed time or train number are skipped`() {
        val xml =
            """
            <Siri xmlns="http://www.siri.org.uk/siri"><ServiceDelivery><EstimatedTimetableDelivery><EstimatedJourneyVersionFrame>
            <EstimatedVehicleJourney><EstimatedCalls><EstimatedCall><AimedDepartureTime>2026-10-31T11:36:00+01:00</AimedDepartureTime>
            <DeparturePlatformName>D</DeparturePlatformName></EstimatedCall></EstimatedCalls></EstimatedVehicleJourney>
            <EstimatedVehicleJourney><TrainNumbers><TrainNumberRef>0895853</TrainNumberRef></TrainNumbers><EstimatedCalls>
            <EstimatedCall><AimedDepartureTime>invalid</AimedDepartureTime><DeparturePlatformName>E</DeparturePlatformName></EstimatedCall>
            <EstimatedCall><AimedDepartureTime>2026-10-31T11:36:00+01:00</AimedDepartureTime><DeparturePlatformName> </DeparturePlatformName></EstimatedCall>
            </EstimatedCalls></EstimatedVehicleJourney></EstimatedJourneyVersionFrame></EstimatedTimetableDelivery></ServiceDelivery></Siri>
            """.trimIndent()
        val index = TrackIndex.parse(xml.byteInputStream())

        assertEquals(1, index.size)
        // the train is matched, its track is not known yet
        assertNull(index.patch(tracksStopTimes.first { it.tripShortName == "895853" }))
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
