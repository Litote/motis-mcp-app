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
import org.litote.motis.client.client.RoutingClient
import org.litote.motis.client.client.TimetableClient
import org.litote.motis.client.model.AlertCause
import org.litote.motis.client.model.AlertEffect
import org.litote.motis.mcp.MockMotis
import org.litote.motis.mcp.MotisGateway
import org.litote.motis.mcp.MotisMcpConfig
import org.litote.motis.mcp.StopTimesQuery
import org.litote.motis.mcp.dto.toDto
import org.litote.motis.mcp.respondJson
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue
import kotlin.time.Instant
import kotlin.time.TestTimeSource

class SncfAlertsTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val stopTimesJson = javaClass.getResource("/realtime/stoptimes-sncf.json")!!.readText()

    /** Departures of Lyon Part Dieu recorded from Transitous: the first one is the TER 886865. */
    private val stopTimes = json.decodeFromString<TimetableClient.StoptimesResponseBody>(stopTimesJson).stopTimes

    private var requests = 0

    private fun translated(vararg texts: Pair<String, String>) = TranslatedString(texts.map { (lang, text) -> Translation(text, lang) })

    /** Alert of the feed of the SNCF for the trains [numbers], as it names them (e.g. `OCESN886865F`), with 2 stops. */
    private fun alert(vararg numbers: String, header: TranslatedString = translated("fr" to "Voitures hors quai", "en" to "Coaches off platform")) =
        GtfsAlert(
            activePeriod = listOf(GtfsTimeRange(start = 1787562540, end = 1797116340)),
            informedEntity =
                numbers.flatMap { n ->
                    listOf("StopArea:OCE87276782", "StopArea:OCE87296418").map { EntitySelector(trip = TripDescriptor(tripId = "OCESN${n}F"), stopId = it) }
                },
            effect = 8,
            headerText = header,
            descriptionText = translated("fr" to "<p>Les dernières voitures ne seront pas reçues à quai.</p>", "en" to "<p>The last coaches will not stop at the platform.</p>"),
        )

    private fun feed(vararg alerts: GtfsAlert): ByteArray =
        ProtoBuf.encodeToByteArray(FeedMessage.serializer(), FeedMessage(entity = alerts.mapIndexed { i, a -> FeedEntity(id = "$i", alert = a) }))

    private fun sncfAlerts(answer: () -> ByteArray?) =
        SncfAlerts(
            HttpClient(
                MockEngine { request ->
                    assertEquals("tests", request.headers[HttpHeaders.UserAgent])
                    requests++
                    answer()?.let { respond(it) } ?: respond("", HttpStatusCode.ServiceUnavailable)
                },
            ),
            userAgent = "tests",
            timeSource = TestTimeSource(),
        )

    @Test
    fun `the alerts of a train are added to its stop times, in the language asked`() =
        runBlocking {
            val alerts = sncfAlerts { feed(alert("886865", "999999")) }

            val english = alerts.addToStopTimes(stopTimes, listOf("en"))
            val french = alerts.addToStopTimes(stopTimes, null)

            assertEquals(listOf("Coaches off platform"), english.first().place.alerts?.map { it.headerText })
            assertEquals(listOf("Voitures hors quai"), french.first().place.alerts?.map { it.headerText })
            assertTrue(english.drop(1).all { it.place.alerts.isNullOrEmpty() })
            // the feed is cached
            assertEquals(1, requests)
        }

    @Test
    fun `the alerts of the SNCF go through the departures of the gateway as the others`() =
        runBlocking {
            val motis = MockMotis { respondJson(stopTimesJson) }
            val config = MotisMcpConfig(contact = "https://example.org/tests")
            val gateway = MotisGateway(config.clientConfiguration(motis.engine), sncfAlerts = sncfAlerts { feed(alert("886865")) })

            val departures = gateway.stopTimes(StopTimesQuery(stopId = stopTimes.first().place.stopId!!)).toDto(arriveBy = false)

            val dto = departures.stopTimes.first().pendingAlerts.single()
            assertEquals("Voitures hors quai", dto.header)
            assertEquals("Les dernières voitures ne seront pas reçues à quai.", dto.description)
            assertNull(dto.effect)
        }

    @Test
    fun `the alerts of a train are added to its legs`() =
        runBlocking {
            val plan = json.decodeFromString<RoutingClient.PlanResponseBody>(javaClass.getResource("/motis/plan.json")!!.readText())
            val itinerary = plan.itineraries.first()
            val transit = itinerary.legs.indexOfFirst { it.tripId != null }
            val sncf =
                itinerary.copy(
                    legs =
                        itinerary.legs.mapIndexed { i, leg ->
                            if (i == transit) leg.copy(tripId = stopTimes.first().tripId, tripShortName = "886865") else leg
                        },
                )

            val result = sncfAlerts { feed(alert("886865")) }.addToItineraries(listOf(sncf, itinerary), listOf("fr"))

            assertEquals(listOf("Voitures hors quai"), result[0].legs[transit].alerts?.map { it.headerText })
            assertSame(itinerary, result[1])
        }

    @Test
    fun `the feed is not downloaded without SNCF trains, and a feed unavailable changes nothing`() =
        runBlocking {
            val unavailable = sncfAlerts { null }
            val others = stopTimes.filterNot { SncfTrains.isSncfTrip(it.tripId) }

            assertSame(others, unavailable.addToStopTimes(others, null))
            assertEquals(0, requests)
            assertEquals(stopTimes, unavailable.addToStopTimes(stopTimes, null))
            assertEquals(1, requests)
        }

    @Test
    fun `the causes, effects and periods are those of MOTIS`() {
        val alert = alert("1").copy(cause = 9, effect = 1, activePeriod = listOf(GtfsTimeRange(start = 1787562540, end = 0))).toMotis(null)

        assertEquals(AlertCause.MAINTENANCE, alert.cause)
        assertEquals(AlertEffect.NO_SERVICE, alert.effect)
        assertEquals(Instant.fromEpochSeconds(1787562540), alert.impactPeriod?.single()?.start)
        assertNull(alert("1").copy(cause = 0, effect = 99).toMotis(null).cause)
        assertNull(alert("1").copy(effect = 99).toMotis(null).effect)
    }

    @Test
    fun `the text is in the first language translated, else in French, else the first one`() {
        val text = translated("de" to "Störung", "fr" to "Perturbation", "en" to "Disruption")

        assertEquals("Disruption", text.text(listOf("pt", "en-GB")))
        assertEquals("Perturbation", text.text(listOf("pt")))
        assertEquals("Störung", translated("de" to "Störung").text(listOf("en")))
        assertEquals("", null.text(listOf("en")))
    }
}
