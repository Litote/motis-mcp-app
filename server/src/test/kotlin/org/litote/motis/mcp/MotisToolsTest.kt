package org.litote.motis.mcp

import io.ktor.http.HttpStatusCode
import io.modelcontextprotocol.kotlin.sdk.types.CallToolResult
import io.modelcontextprotocol.kotlin.sdk.types.TextContent
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.json.Json
import org.litote.motis.mcp.dto.AreaResult
import org.litote.motis.mcp.dto.JourneyResult
import org.litote.motis.mcp.dto.ReachabilityResult
import org.litote.motis.mcp.dto.SearchResult
import org.litote.motis.mcp.dto.ServerInfoResult
import org.litote.motis.mcp.dto.TripResult
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** MOTIS answers recorded from Transitous (around Lyon Part-Dieu), reduced: see src/test/resources/motis. */
private val FIXTURES =
    mapOf(
        "/api/v1/geocode" to "geocode",
        "/api/v1/reverse-geocode" to "reverse",
        "/api/v1/health" to "health",
        "/api/v1/map/initial" to "initial",
        "/api/v6/map/stops" to "stops",
        "/api/experimental/map/routes" to "routes",
        "/api/experimental/map/route-details" to "routedetails",
        "/api/v6/stoptimes" to "stoptimes",
        "/api/v6/trip" to "trip",
        "/api/v6/plan" to "plan",
        "/api/v6/one-to-all" to "onetoall",
    )

private fun fixture(name: String): String = MotisToolsTest::class.java.getResource("/motis/$name.json")!!.readText()

private fun transitous(): MockMotis =
    MockMotis { request ->
        respondJson(fixture(FIXTURES[request.url.encodedPath] ?: error("unexpected ${request.url}")))
    }

private val json = Json { ignoreUnknownKeys = true }

private fun <T> CallToolResult.data(deserializer: DeserializationStrategy<T>): T {
    assertNull(isError, text())
    return json.decodeFromJsonElement(deserializer, assertNotNull(structuredContent))
}

private fun CallToolResult.text(): String = (content.single() as TextContent).text

private fun MockMotis.request(path: String) = requests.single { it.url.encodedPath == path }

class MotisToolsTest {
    @Test
    fun `search_places geocodes the text with the filters`() {
        val motis = transitous()
        withMcpClient(motis) { client ->
            val result =
                client.callTool(
                    "search_places",
                    mapOf("text" to "Lyon Part-Dieu", "types" to listOf("stop", "unknown"), "near" to "45.76,4.86", "limit" to 2, "language" to "fr"),
                )

            val search = result.data(SearchResult.serializer())
            assertEquals(listOf("LYON-PART-DIEU", "Lyon Part Dieu (FR)"), search.matches.map { it.name })
            assertEquals("STOP", search.matches.first().type)
            val request = motis.request("/api/v1/geocode")
            assertEquals("Lyon Part-Dieu", request.url.parameters["text"])
            assertEquals("STOP", request.url.parameters["type"])
            assertEquals("45.76,4.86", request.url.parameters["place"])
            assertEquals("2", request.url.parameters["numResults"])
            assertEquals("fr", request.url.parameters["language"])
            assertTrue(result.text().startsWith("2 result(s) for \"Lyon Part-Dieu\":\n- LYON-PART-DIEU [STOP] id=es-RENFE"), result.text())
        }
    }

    @Test
    fun `search_places reverse geocodes coordinates`() {
        val motis = transitous()
        withMcpClient(motis) { client ->
            val result = client.callTool("search_places", mapOf("text" to "45.7605,4.8597", "limit" to 3))

            val search = result.data(SearchResult.serializer())
            assertEquals(3, search.matches.size)
            assertTrue(search.matches.all { it.type == "PLACE" })
            assertEquals("45.7605,4.8597", motis.request("/api/v1/reverse-geocode").url.parameters["place"])
            assertTrue(motis.requests.none { it.url.encodedPath == "/api/v1/geocode" })
        }
    }

    @Test
    fun `search_places without match`() {
        withMcpClient(MockMotis { respondJson("[]") }) { client ->
            val result = client.callTool("search_places", mapOf("text" to "Nowhere"))

            assertEquals(emptyList(), result.data(SearchResult.serializer()).matches)
            assertEquals("No place found for \"Nowhere\".", result.text())
        }
    }

    @Test
    fun `server_info describes the server`() {
        withMcpClient(transitous()) { client ->
            val result = client.callTool("server_info", emptyMap())

            val info = result.data(ServerInfoResult.serializer())
            assertEquals("v2.11.3", info.motisVersion)
            assertEquals(true, info.realTime)
            assertEquals(true, info.gbfs)
            assertEquals(2880.0, info.maxOneToAllTravelTimeMinutes)
            assertEquals(4.0, info.initialZoom)
            assertTrue(result.text().startsWith("MOTIS v2.11.3 at https://api.transitous.org/"), result.text())
        }
    }

    @Test
    fun `server_info of an unhealthy server`() {
        val motis =
            MockMotis { request ->
                when (request.url.encodedPath) {
                    "/api/v1/health" -> respondJson("""{"rt":false,"gbfs":false}""", HttpStatusCode.BadRequest)
                    else -> respondJson(fixture("initial"))
                }
            }
        withMcpClient(motis) { client ->
            val info = client.callTool("server_info", emptyMap()).data(ServerInfoResult.serializer())

            assertEquals(false, info.realTime)
        }
    }

    @Test
    fun `explore_area groups the route variants and links the polylines to the routes`() {
        val motis = transitous()
        withMcpClient(motis) { client ->
            val result = client.callTool("explore_area", mapOf("place" to "45.7605,4.8597", "radiusKm" to 0.5, "modes" to listOf("BUS")))

            val area = result.data(AreaResult.serializer())
            assertEquals("area", area.kind)
            assertEquals("45.7605,4.8597 (0.5 km)", area.title)
            assertEquals(12, area.totalStops)
            // the main stops first
            assertEquals("LYON-PART-DIEU", area.stops.first().name)
            // the two AVE INT variants are grouped under the longest one; the routes without names come last
            assertEquals(4, area.totalRoutes)
            val ave = area.routes.single { it.names == listOf("AVE INT") }
            assertEquals(803145, ave.routeIdx)
            assertEquals(2, ave.variants)
            assertEquals("#f2f5f5", ave.color)
            assertEquals(915397, area.routes.last().routeIdx)
            assertEquals(listOf("HIGHSPEED_RAIL", "SUBWAY", "BUS", "HIGHSPEED_RAIL"), area.routes.map { it.mode })
            // polylines reference the routes by routeIdx (MOTIS references them by position)
            val routeIdx = area.routes.map { it.routeIdx }.toSet()
            assertTrue(area.polylines.isNotEmpty())
            assertTrue(area.polylines.all { routeIdx.containsAll(it.routeIdx) }, area.polylines.map { it.routeIdx }.toString())
            assertTrue(area.polylines.any { it.routeIdx == listOf(940073L) && it.color == "#e8308a" })

            assertEquals("BUS", motis.request("/api/v6/map/stops").url.parameters["modes"])
            val routes = motis.request("/api/experimental/map/routes")
            assertEquals(area.zoom, routes.url.parameters["zoom"]?.toDouble())
            val text = result.text()
            assertTrue(text.startsWith("45.7605,4.8597 (0.5 km): 12 stop(s), 4 route(s)."), text)
            assertTrue(text.contains("- 803145: HIGHSPEED_RAIL AVE INT (9 stops)"), text)
            assertTrue(text.contains("Main stops (stopId):\n- LYON-PART-DIEU (it-trenitalia_870072319) HIGHSPEED_RAIL"), text)
        }
    }

    @Test
    fun `explore_area with bounds`() {
        val motis = transitous()
        withMcpClient(motis) { client ->
            val result = client.callTool("explore_area", mapOf("minLat" to 45.756, "minLon" to 4.853, "maxLat" to 45.765, "maxLon" to 4.866))

            assertEquals("(45.756,4.853)–(45.765,4.866)", result.data(AreaResult.serializer()).title)
            val stops = motis.request("/api/v6/map/stops")
            assertEquals("45.756,4.853", stops.url.parameters["min"])
            assertEquals("45.765,4.866", stops.url.parameters["max"])
        }
    }

    @Test
    fun `explore_area rejects invalid areas`() {
        val motis = MockMotis { error("no MOTIS call expected") }
        withMcpClient(motis) { client ->
            val inverted = client.callTool("explore_area", mapOf("minLat" to 46, "minLon" to 4.853, "maxLat" to 45.765, "maxLon" to 4.866))
            assertEquals(true, inverted.isError)
            assertEquals("Invalid argument: min must be south-west of max", inverted.text())

            val missing = client.callTool("explore_area", emptyMap())
            assertEquals(true, missing.isError)
            assertEquals("Invalid argument: 'place' or the four bounds are required", missing.text())
        }
    }

    @Test
    fun `route_details shows the route with its stops`() {
        val motis = transitous()
        withMcpClient(motis) { client ->
            val result = client.callTool("route_details", mapOf("routeIdx" to 943560, "language" to "fr"))

            val route = result.data(AreaResult.serializer())
            assertEquals("routeDetails", route.kind)
            assertEquals("TRAM T4", route.title)
            assertEquals(16, route.stops.size)
            assertEquals("#662483", route.routes.single().color)
            assertEquals("#ffffff", route.routes.single().textColor)
            assertTrue(route.polylines.isNotEmpty())
            assertTrue(route.polylines.all { it.routeIdx == listOf(943560L) })
            assertTrue(route.bbox.minLat < route.bbox.maxLat)
            assertEquals("943560", motis.request("/api/experimental/map/route-details").url.parameters["routeIdx"])
            assertTrue(result.text().startsWith("TRAM T4: 16 stop(s): Lycée Lumière → "), result.text())
            assertTrue(result.text().endsWith(" → IUT Feyssine"), result.text())
        }
    }

    @Test
    fun `reachability lists the places reachable within the travel time`() {
        val motis = transitous()
        withMcpClient(motis) { client ->
            val result =
                client.callTool(
                    "reachability",
                    mapOf("place" to "45.7605,4.8597", "maxTravelTimeMinutes" to 10, "arriveBy" to true, "maxTransfers" to 1, "modes" to listOf("TRAM")),
                )

            val reachability = result.data(ReachabilityResult.serializer())
            assertEquals(56, reachability.totalPlaces)
            assertEquals(10, reachability.maxTravelTimeMinutes)
            assertEquals(45.7605, reachability.origin.lat, 0.001)
            // closest first
            val durations = reachability.places.mapNotNull { it.durationMinutes }
            assertEquals(durations.sorted(), durations)
            val request = motis.request("/api/v6/one-to-all")
            assertEquals("45.7605,4.8597", request.url.parameters["one"])
            assertEquals("10", request.url.parameters["maxTravelTime"])
            assertEquals("true", request.url.parameters["arriveBy"])
            assertEquals("1", request.url.parameters["maxTransfers"])
            assertEquals("TRAM", request.url.parameters["transitModes"])
            assertTrue(result.text().startsWith("56 stop(s) reachable from 45.7605,4.8597 within 10 min.\n- 0–9 min: "), result.text())
        }
    }

    @Test
    fun `departures by stop id, arrivals of a page`() {
        val motis = transitous()
        withMcpClient(motis) { client ->
            val result =
                client.callTool(
                    "departures",
                    mapOf("stopId" to "es-RENFE-Larga-Distancia-y-AVE_87303", "arriveBy" to true, "pageCursor" to "CURSOR", "modes" to listOf("HIGHSPEED_RAIL")),
                )

            assertNull(result.isError)
            val request = motis.request("/api/v6/stoptimes")
            assertEquals("true", request.url.parameters["arriveBy"])
            assertEquals("CURSOR", request.url.parameters["pageCursor"])
            assertEquals("HIGHSPEED_RAIL", request.url.parameters["mode"])
            assertTrue(motis.requests.none { it.url.encodedPath == "/api/v1/geocode" })
            val text = result.text()
            assertTrue(text.startsWith("Arrivals at Lyon Part Dieu (stopId="), text)
            assertTrue(text.contains("HIGHSPEED_RAIL TGV INOUI 6633"), text)
        }
    }

    @Test
    fun `departures requires a stop`() {
        withMcpClient(MockMotis { error("no MOTIS call expected") }) { client ->
            val result = client.callTool("departures", emptyMap())

            assertEquals(true, result.isError)
            assertEquals("Invalid argument: 'stopId' or 'stop' is required", result.text())
        }
    }

    @Test
    fun `trip_details lists the stops of the trip`() {
        val motis = transitous()
        withMcpClient(motis) { client ->
            val tripId = "20261012_21:00_fr-horaires-sncf_FR:ServiceJourney::SN6633FERRE_12999392"
            val result = client.callTool("trip_details", mapOf("tripId" to tripId))

            val trip = result.data(TripResult.serializer())
            assertEquals(tripId, trip.tripId)
            val leg = trip.itinerary.legs.single()
            assertEquals("TGV INOUI 6633", leg.line)
            assertEquals("Paris Gare de Lyon Hall 1 - 2", leg.from.name)
            assertEquals("Lyon Perrache", leg.to.name)
            assertEquals(3, leg.intermediateStops?.size)
            assertEquals(8640, trip.itinerary.durationSeconds)
            assertEquals(tripId, motis.request("/api/v6/trip").url.parameters["tripId"])
            assertTrue(result.text().contains("Lyon Perrache"), result.text())
        }
    }

    @Test
    fun `plan_journey resolves the places and returns the itineraries`() {
        val motis = transitous()
        withMcpClient(motis) { client ->
            val result =
                client.callTool(
                    "plan_journey",
                    mapOf(
                        "from" to "45.7605,4.8597",
                        "to" to "Lyon Part-Dieu",
                        "time" to "2026-10-12T22:00:00+02:00",
                        "arriveBy" to true,
                        "modes" to listOf("BUS", "TRAM"),
                        "maxTransfers" to 2,
                        "maxWalkMinutes" to 10,
                        "count" to 3,
                    ),
                )

            val journey = result.data(JourneyResult.serializer())
            assertEquals(3, journey.itineraries.size)
            val first = journey.itineraries.first()
            assertEquals(listOf("WALK", "BUS", "WALK"), first.legs.map { it.mode })
            assertEquals("C23", first.legs[1].line)
            assertNotNull(journey.nextPageCursor)

            val request = motis.request("/api/v6/plan")
            assertEquals("45.7605,4.8597", request.url.parameters["fromPlace"])
            assertEquals("es-RENFE-Larga-Distancia-y-AVE_87303", request.url.parameters["toPlace"])
            assertEquals("true", request.url.parameters["arriveBy"])
            assertEquals("2", request.url.parameters["maxTransfers"])
            assertEquals("3", request.url.parameters["numItineraries"])
            assertEquals("2026-10-12T20:00:00Z", request.url.parameters["time"])
            assertEquals("BUS,TRAM", request.url.parameters["transitModes"])
            assertEquals("600", request.url.parameters["maxPreTransitTime"])
            assertEquals("600", request.url.parameters["maxPostTransitTime"])
            assertEquals("true", request.url.parameters["useRoutedTransfers"])
            assertNull(request.url.parameters["maxMatchingDistance"])
            assertTrue(result.text().startsWith("From 45.7605,4.8597 to LYON-PART-DIEU: 3 itinerary(ies).\n1. "), result.text())
        }
    }

    @Test
    fun `plan_journey walks up to 25 minutes to the first stop and from the last stop by default`() {
        val motis = transitous()
        withMcpClient(motis) { client ->
            client.callTool("plan_journey", mapOf("from" to "45.7605,4.8597", "to" to "45.19,5.71"))

            val request = motis.request("/api/v6/plan")
            assertEquals("1500", request.url.parameters["maxPreTransitTime"])
            assertEquals("1500", request.url.parameters["maxPostTransitTime"])
        }
    }

    @Test
    fun `unknown places are tool errors`() {
        withMcpClient(MockMotis { respondJson("[]") }) { client ->
            val result = client.callTool("plan_journey", mapOf("from" to "Nowhere", "to" to "45.7,4.8"))

            assertEquals(true, result.isError)
            assertEquals("No place found for \"Nowhere\"", result.text())
        }
    }

    @Test
    fun `MOTIS failures without error body are tool errors`() {
        withMcpClient(MockMotis { respondJson("oops", HttpStatusCode.InternalServerError) }) { client ->
            val result = client.callTool("trip_details", mapOf("tripId" to "trip"))

            assertEquals(true, result.isError)
            assertTrue(result.text().contains("500"), result.text())
        }
    }
}
