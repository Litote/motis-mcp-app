package org.litote.motis.mcp.cities

import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpStatusCode
import io.modelcontextprotocol.kotlin.sdk.types.CallToolResult
import io.modelcontextprotocol.kotlin.sdk.types.TextContent
import kotlinx.serialization.json.Json
import org.litote.motis.mcp.MockMotis
import org.litote.motis.mcp.MotisToolException
import org.litote.motis.mcp.dto.JourneyResult
import org.litote.motis.mcp.respondJson
import org.litote.motis.mcp.withMcpClient
import java.time.Instant
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val MONTPARNASSE = "montparnasse"
private const val MASSY = "massy"
private const val NANTES = "nantes"

/** Paris and Nantes geocoded as cities; the journeys from their centers, and from the stations of Paris to Nantes. */
private class ParisNantes(
    private val failingPairs: Set<String> = emptySet(),
    private val onlyCoaches: Boolean = false,
) {
    private val center = place("START", 48.853, 2.348)
    private val cite = place("Cité", 48.855, 2.347, "m4-cite")
    private val saintMichel = place("Saint-Michel", 48.853, 2.344, "rer-stmichel")
    private val montparnasse = place("Paris Montparnasse", 48.841, 2.320, MONTPARNASSE)
    private val massy = place("Massy TGV", 48.726, 2.261, MASSY)
    private val nantes = place("Nantes", 47.217, -1.542, NANTES)
    private val end = place("END", 47.218, -1.554)

    val motis =
        MockMotis { request ->
            when (request.url.encodedPath) {
                "/api/v1/geocode" -> {
                    val text = request.url.parameters["text"]!!
                    val (lat, lon) = if (text == "Paris") 48.853 to 2.348 else 47.218 to -1.554
                    respondJson(
                        """[{"type":"PLACE","category":"place_6","name":"$text","id":"node/$text","lat":$lat,"lon":$lon,""" +
                            """"score":0.0,"tokens":[],"areas":[],"tz":"Europe/Paris"}]""",
                    )
                }
                "/api/v6/plan" -> {
                    val from = request.url.parameters["fromPlace"]!!
                    if (from in failingPairs) {
                        respondJson("""{"error":"no route"}""", HttpStatusCode.BadRequest)
                    } else {
                        respondJson(plan(from, request.url.parameters["pageCursor"]))
                    }
                }
                else -> error("unexpected ${request.url}")
            }
        }

    private fun plan(from: String, cursor: String?): String =
        when {
            onlyCoaches -> plan(listOf(itinerary(leg("COACH", center, end, "22:00", "23:30", "coach"))), "", "")
            else -> stationPlan(from, cursor)
        }

    private fun stationPlan(from: String, cursor: String?): String =
        when (from) {
            MONTPARNASSE ->
                if (cursor == null) {
                    plan(listOf(tgv(montparnasse, "tgv-a", "06:00")), "mp-next", "mp-previous")
                } else {
                    plan(listOf(tgv(montparnasse, "tgv-c", "10:00")), "mp-next-2", "mp-next")
                }
            MASSY -> plan(listOf(tgv(massy, "tgv-b", "06:30")), "massy-next", "massy-previous")
            // the centers: metro to Montparnasse, regional train to Massy
            else ->
                plan(
                    listOf(
                        itinerary(
                            leg("WALK", center, cite, "05:30", "05:35"),
                            leg("SUBWAY", cite, montparnasse, "05:35", "05:50", "m4"),
                            leg("HIGHSPEED_RAIL", montparnasse, nantes, "06:00", "08:00", "tgv-a"),
                            leg("WALK", nantes, end, "08:00", "08:10"),
                        ),
                        itinerary(
                            leg("WALK", center, saintMichel, "05:50", "05:55"),
                            leg("REGIONAL_RAIL", saintMichel, massy, "05:55", "06:20", "rer-b"),
                            leg("HIGHSPEED_RAIL", massy, nantes, "06:30", "08:30", "tgv-b"),
                            leg("WALK", nantes, end, "08:30", "08:40"),
                        ),
                    ),
                    "center-next",
                    "center-previous",
                )
        }

    private fun tgv(from: String, tripId: String, start: String) =
        itinerary(leg("HIGHSPEED_RAIL", from, nantes, start, start.replaceRange(0, 2, "%02d".format(start.take(2).toInt() + 2)), tripId))

    private fun plan(itineraries: List<String>, next: String, previous: String) =
        """{"requestParameters":{},"debugOutput":{},"from":$center,"to":$end,"direct":[],""" +
            """"itineraries":[${itineraries.joinToString(",")}],"nextPageCursor":"$next","previousPageCursor":"$previous"}"""

    private fun itinerary(vararg legs: Leg) =
        """{"id":"${legs.first().start}","duration":0,"transfers":${legs.count { it.tripId != null } - 1},""" +
            """"startTime":"${time(legs.first().start)}","endTime":"${time(legs.last().end)}","legs":[${legs.joinToString(",") { it.json }}]}"""

    private class Leg(val start: String, val end: String, val tripId: String?, val json: String)

    private fun leg(mode: String, from: String, to: String, start: String, end: String, tripId: String? = null) =
        Leg(
            start,
            end,
            tripId,
            """{"mode":"$mode","from":$from,"to":$to,"duration":0,"startTime":"${time(start)}","endTime":"${time(end)}",""" +
                """"scheduledStartTime":"${time(start)}","scheduledEndTime":"${time(end)}","realTime":false,"scheduled":true,""" +
                """"legGeometry":{"points":"","precision":6,"length":0}${tripId?.let { ""","tripId":"$it"""" } ?: ""}}""",
        )

    private fun time(hhmm: String) = "2026-11-04T$hhmm:00Z"

    private fun place(name: String, lat: Double, lon: Double, stopId: String? = null) =
        """{"name":"$name","lat":$lat,"lon":$lon${stopId?.let { ""","stopId":"$it"""" } ?: ""}}"""
}

private val json = Json { ignoreUnknownKeys = true }

private fun CallToolResult.journey(): JourneyResult {
    assertNull(isError, (content.single() as TextContent).text)
    return json.decodeFromJsonElement(JourneyResult.serializer(), assertNotNull(structuredContent))
}

private fun CallToolResult.text(): String = (content.single() as TextContent).text

private fun MockMotis.plans(): List<HttpRequestData> = requests.filter { it.url.encodedPath == "/api/v6/plan" }

private const val PAIR = "48.853,2.348>47.218,-1.554"

private val PARIS_NANTES = mapOf("from" to "Paris", "to" to "Nantes", "time" to "2026-11-04T06:00:00+01:00")

private fun List<JourneyResult>.trips() = flatMap { journey -> journey.itineraries.map { it.legs.mapNotNull { leg -> leg.tripId } } }

class CityJourneysTest {
    @Test
    fun `the stations of two cities are discovered from the journeys between their centers`() {
        val paris = ParisNantes()
        val store = InMemoryCityStationsStore()
        withMcpClient(paris.motis, store) { client ->
            val journey = client.callTool("plan_journey", PARIS_NANTES).journey()

            // cut at the stations
            assertEquals(listOf(listOf("tgv-a"), listOf("tgv-b")), listOf(journey).trips())
            val request = paris.motis.plans().single()
            assertEquals("48.853,2.348", request.url.parameters["fromPlace"])
            assertEquals("${CityJourneys.DISCOVERY_ITINERARIES}", request.url.parameters["numItineraries"])
            // a cursor of MOTIS: the next journeys between the centers
            assertEquals("center-next", journey.nextPageCursor)

            val stations = assertNotNull(store.get("48.853,2.348>47.218,-1.554"))
            assertEquals(listOf(MONTPARNASSE, MASSY), stations.from)
            assertEquals(listOf(NANTES), stations.to)
        }
    }

    @Test
    fun `the journeys between two known cities are searched from station to station and merged`() {
        val paris = ParisNantes()
        withMcpClient(paris.motis) { client ->
            client.callTool("plan_journey", PARIS_NANTES)
            paris.motis.requests.clear()

            val result = client.callTool("plan_journey", PARIS_NANTES)
            val journey = result.journey()

            val pairs = paris.motis.plans().map { it.url.parameters["fromPlace"] to it.url.parameters["toPlace"] }
            assertEquals(setOf(MONTPARNASSE to NANTES, MASSY to NANTES), pairs.toSet())
            // the time asked is the departure from the stations
            assertTrue(paris.motis.plans().all { it.url.parameters["time"] == "2026-11-04T05:00:00Z" })
            assertEquals(listOf(listOf("tgv-a"), listOf("tgv-b")), listOf(journey).trips())
            assertEquals("Paris", journey.from.name)
            assertEquals("Nantes", journey.to.name)
            assertTrue(result.text().contains("stations of Paris and Nantes"), result.text())

            // the next journeys of each pair of stations
            val next = assertNotNull(journey.nextPageCursor)
            assertTrue(next.startsWith("stations:"), next)
            assertEquals(
                listOf(StationPair(MONTPARNASSE, NANTES, "mp-next"), StationPair(MASSY, NANTES, "massy-next")),
                StationPairsCursor.decode(next)!!.pairs.sortedByDescending { it.from },
            )
            paris.motis.requests.clear()
            val page = client.callTool("plan_journey", PARIS_NANTES + ("pageCursor" to next)).journey()
            assertEquals(
                setOf(MONTPARNASSE to "mp-next", MASSY to "massy-next"),
                paris.motis.plans().map { it.url.parameters["fromPlace"] to it.url.parameters["pageCursor"] }.toSet(),
            )
            assertEquals(listOf(listOf("tgv-b"), listOf("tgv-c")), listOf(page).trips())
        }
    }

    @Test
    fun `the next journeys of a discovery are those between the centers`() {
        val paris = ParisNantes()
        withMcpClient(paris.motis) { client ->
            val discovery = client.callTool("plan_journey", PARIS_NANTES).journey()
            paris.motis.requests.clear()

            val next = client.callTool("plan_journey", PARIS_NANTES + ("pageCursor" to discovery.nextPageCursor!!)).journey()

            val request = paris.motis.plans().single()
            assertEquals("48.853,2.348", request.url.parameters["fromPlace"])
            assertEquals("center-next", request.url.parameters["pageCursor"])
            assertEquals(listOf(listOf("tgv-a"), listOf("tgv-b")), listOf(next).trips())
        }
    }

    @Test
    fun `an invalid cursor of the pairs of stations is reported`() {
        withMcpClient(ParisNantes().motis) { client ->
            val result = client.callTool("plan_journey", PARIS_NANTES + ("pageCursor" to "stations:e30"))

            assertEquals(true, result.isError)
            assertTrue(result.text().contains("'pageCursor' is not a cursor returned by plan_journey"), result.text())
        }
    }

    @Test
    fun `all the pairs of stations failing fail the journey`() {
        val paris = ParisNantes(failingPairs = setOf(MONTPARNASSE, MASSY))
        val store = InMemoryCityStationsStore()
        withMcpClient(paris.motis, store) { client ->
            store.put("48.853,2.348>47.218,-1.554", CityStations(listOf(MONTPARNASSE, MASSY), listOf(NANTES), Instant.now()))

            val result = client.callTool("plan_journey", PARIS_NANTES)

            assertEquals(true, result.isError)
            assertTrue(result.text().contains("no route"), result.text())
        }
    }

    @Test
    fun `a pair of stations without journeys is left out`() {
        val paris = ParisNantes(failingPairs = setOf(MASSY))
        val store = InMemoryCityStationsStore()
        withMcpClient(paris.motis, store) { client ->
            store.put("48.853,2.348>47.218,-1.554", CityStations(listOf(MONTPARNASSE, MASSY), listOf(NANTES), Instant.now()))

            val journey = client.callTool("plan_journey", PARIS_NANTES).journey()

            assertEquals(listOf(listOf("tgv-a")), listOf(journey).trips())
            assertEquals(listOf(StationPair(MONTPARNASSE, NANTES, "mp-next")), StationPairsCursor.decode(journey.nextPageCursor!!)!!.pairs)
        }
    }

    @Test
    fun `old stations are discovered again`() {
        val paris = ParisNantes()
        val store = InMemoryCityStationsStore()
        withMcpClient(paris.motis, store) { client ->
            store.put("48.853,2.348>47.218,-1.554", CityStations(listOf(MASSY), listOf(NANTES), Instant.EPOCH))

            client.callTool("plan_journey", PARIS_NANTES).journey()

            assertEquals("48.853,2.348", paris.motis.plans().single().url.parameters["fromPlace"])
            assertEquals(listOf(MONTPARNASSE, MASSY), store.get("48.853,2.348>47.218,-1.554")!!.from)
        }
    }

    @Test
    fun `the stations found by a new search between the centers are added to the known ones`() {
        val paris = ParisNantes()
        val store = InMemoryCityStationsStore()
        val discoveredAt = Instant.now()
        withMcpClient(paris.motis, store, rediscoverStations = { true }) { client ->
            store.put(PAIR, CityStations(listOf("old", MASSY), listOf(NANTES), discoveredAt))

            val journey = client.callTool("plan_journey", PARIS_NANTES).journey()

            // the journey of this request is from the known stations
            assertEquals(setOf("48.853,2.348", "old", MASSY), paris.motis.plans().map { it.url.parameters["fromPlace"] }.toSet())
            assertTrue(journey.nextPageCursor!!.startsWith("stations:"))
            assertEquals(CityStations(listOf(MONTPARNASSE, MASSY, "old"), listOf(NANTES), discoveredAt), store.get(PAIR))
        }
    }

    @Test
    fun `the known stations are not searched again without need`() {
        val paris = ParisNantes()
        val store = InMemoryCityStationsStore()
        val calls = AtomicInteger()
        withMcpClient(paris.motis, store, rediscoverStations = { calls.incrementAndGet() > 1 }) { client ->
            store.put(PAIR, CityStations(listOf(MONTPARNASSE), listOf(NANTES), Instant.now()))

            val journey = client.callTool("plan_journey", PARIS_NANTES).journey()
            assertEquals(listOf(MONTPARNASSE), paris.motis.plans().map { it.url.parameters["fromPlace"] })

            // the next page is no new search
            paris.motis.requests.clear()
            client.callTool("plan_journey", PARIS_NANTES + ("pageCursor" to journey.nextPageCursor!!)).journey()
            assertEquals(listOf(MONTPARNASSE), paris.motis.plans().map { it.url.parameters["fromPlace"] })
            assertEquals(1, calls.get())
        }
    }

    @Test
    fun `a failure of the new search between the centers does not fail the journey`() {
        val paris = ParisNantes(failingPairs = setOf("48.853,2.348"))
        val store = InMemoryCityStationsStore()
        val known = CityStations(listOf(MASSY), listOf(NANTES), Instant.now())
        withMcpClient(paris.motis, store, rediscoverStations = { true }) { client ->
            store.put(PAIR, known)

            val journey = client.callTool("plan_journey", PARIS_NANTES).journey()

            assertEquals(listOf(listOf("tgv-b")), listOf(journey).trips())
            assertEquals(known, store.get(PAIR))
        }
    }

    @Test
    fun `no station is kept when the journeys take no long-distance train`() {
        val paris = ParisNantes(onlyCoaches = true)
        val store = InMemoryCityStationsStore()
        withMcpClient(paris.motis, store) { client ->
            val journey = client.callTool("plan_journey", PARIS_NANTES).journey()

            assertEquals(listOf(listOf("coach")), listOf(journey).trips())
            // e.g. only coaches at night: the trains of the day are discovered by the next journey
            assertNull(store.get("48.853,2.348>47.218,-1.554"))
        }
    }

    @Test
    fun `a failure of the store does not fail the journey`() {
        val paris = ParisNantes()
        val failing =
            object : CityStationsStore {
                override suspend fun get(key: String): CityStations = error("DynamoDB unavailable")

                override suspend fun put(key: String, stations: CityStations): Unit = error("DynamoDB unavailable")
            }
        withMcpClient(paris.motis, failing) { client ->
            val journey = client.callTool("plan_journey", PARIS_NANTES).journey()

            assertEquals(listOf(listOf("tgv-a"), listOf("tgv-b")), listOf(journey).trips())
        }
    }

    @Test
    fun `at most 4 pairs of the most used stations are searched`() {
        assertEquals(
            listOf("a" to "x", "a" to "y", "b" to "x", "b" to "y"),
            CityJourneys.stationPairs(listOf("a", "b", "c", "d"), listOf("x", "y", "z")),
        )
        assertEquals(listOf("a" to "x", "b" to "x", "c" to "x"), CityJourneys.stationPairs(listOf("a", "b", "c"), listOf("x")))
    }

    @Test
    fun `the cursor of the pairs of stations is told from a MOTIS cursor`() {
        val cursor = StationPairsCursor(listOf(StationPair("a", "b", "c")))

        assertEquals(cursor, StationPairsCursor.decode(cursor.encode()))
        assertNull(StationPairsCursor.decode("motis-cursor"))
        assertFailsWith<MotisToolException> { StationPairsCursor.decode("stations:not base64") }
    }
}
