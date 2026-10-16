package org.litote.motis.mcp

import io.ktor.http.HttpStatusCode
import io.modelcontextprotocol.kotlin.sdk.types.CallToolResult
import io.modelcontextprotocol.kotlin.sdk.types.TextContent
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.json.Json
import org.litote.motis.mcp.dto.AreaResult
import org.litote.motis.mcp.dto.DeparturesResult
import org.litote.motis.mcp.dto.JourneyResult
import org.litote.motis.mcp.dto.ReachabilityResult
import org.litote.motis.mcp.dto.SearchResult
import org.litote.motis.mcp.dto.ServerInfoResult
import org.litote.motis.mcp.dto.StationLineDto
import org.litote.motis.mcp.dto.StopCallDto
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
    fun `geocoding and server state are cached, timetables are not`() {
        val motis = transitous()
        withMcpClient(motis) { client ->
            fun calls(path: String) = motis.requests.count { it.url.encodedPath == path }
            val stopTimesCalls =
                List(2) {
                    client.callTool("search_places", mapOf("text" to "Lyon Part-Dieu"))
                    client.callTool("server_info", emptyMap())
                    client.callTool("departures", mapOf("stopId" to "stop"))
                    calls("/api/v6/stoptimes")
                }
            client.callTool("search_places", mapOf("text" to "Lyon Part-Dieu", "language" to "fr"))

            assertEquals(2, calls("/api/v1/geocode"))
            assertEquals(1, calls("/api/v1/health"))
            assertEquals(1, calls("/api/v1/map/initial"))
            // the departures are asked again (only the lines of the station are cached)
            assertTrue(stopTimesCalls[1] > stopTimesCalls[0])
        }
    }

    @Test
    fun `the lines of a station are cached, except for a given time`() {
        val motis = transitous()
        withMcpClient(motis) { client ->
            suspend fun stopTimesCalls(arguments: Map<String, Any>): Int {
                val before = motis.requests.count { it.url.encodedPath == "/api/v6/stoptimes" }
                val result = client.callTool("departures", arguments)
                assertNotNull(result.data(DeparturesResult.serializer()).stationLines)
                return motis.requests.count { it.url.encodedPath == "/api/v6/stoptimes" } - before
            }

            // one probe per family of lines: long-distance trains, other trains, metros, trams, buses
            val probes = 5
            val first = stopTimesCalls(mapOf("stopId" to "stop"))
            assertEquals(first - probes, stopTimesCalls(mapOf("stopId" to "stop")))
            assertEquals(first, stopTimesCalls(mapOf("stopId" to "stop", "language" to "fr")))
            assertEquals(first, stopTimesCalls(mapOf("stopId" to "stop", "time" to "2026-10-12T23:00:00+02:00")))
        }
    }

    @Test
    fun `integer arguments out of their bounds are tool errors`() {
        val motis = transitous()
        withMcpClient(motis) { client ->
            val departures = client.callTool("departures", mapOf("stopId" to "stop", "count" to 1000))
            assertEquals(true, departures.isError)
            assertEquals("Invalid argument: 'count' must be between 1 and 100", departures.text())

            val reachability = client.callTool("reachability", mapOf("place" to "45.7605,4.8597", "maxTravelTimeMinutes" to 100_000))
            assertEquals("Invalid argument: 'maxTravelTimeMinutes' must be between 1 and 240", reachability.text())

            val route = client.callTool("route_details", mapOf("routeIdx" to -1))
            assertEquals("Invalid argument: 'routeIdx' must be at least 0", route.text())

            assertEquals(emptyList(), motis.requests)
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
            val result = client.callTool("explore_area", mapOf("place" to "45.7605,4.8597", "radiusKm" to 0.5))

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

            val routes = motis.request("/api/experimental/map/routes")
            assertEquals(area.zoom, routes.url.parameters["zoom"]?.toDouble())
            val text = result.text()
            assertTrue(text.startsWith("45.7605,4.8597 (0.5 km): 12 stop(s), 4 route(s)."), text)
            assertTrue(text.contains("- 803145: HIGHSPEED_RAIL AVE INT (9 stops)"), text)
            assertTrue(text.contains("Main stops (stopId):\n- LYON-PART-DIEU (it-trenitalia_870072319) HIGHSPEED_RAIL"), text)
        }
    }

    @Test
    fun `explore_area keeps the stops and routes of the requested modes`() {
        val motis = transitous()
        withMcpClient(motis) { client ->
            val bus = client.callTool("explore_area", mapOf("place" to "45.7605,4.8597", "modes" to listOf("BUS"))).data(AreaResult.serializer())

            assertEquals("BUS", motis.requests.first { it.url.encodedPath == "/api/v6/map/stops" }.url.parameters["modes"])
            assertEquals(listOf(940073L), bus.routes.map { it.routeIdx })
            assertEquals(1, bus.totalRoutes)
            assertEquals(listOf(listOf(940073L)), bus.polylines.map { it.routeIdx })
            assertEquals(8, bus.totalStops)
            assertTrue(bus.stops.all { "BUS" in it.modes.orEmpty() }, bus.stops.toString())

            // RAIL: the trains and the metros
            val rail = client.callTool("explore_area", mapOf("place" to "45.7605,4.8597", "modes" to listOf("RAIL"))).data(AreaResult.serializer())
            assertEquals(listOf("HIGHSPEED_RAIL", "SUBWAY", "HIGHSPEED_RAIL"), rail.routes.map { it.mode })
            assertEquals(setOf("LYON-PART-DIEU", "Lyon Part Dieu"), rail.stops.map { it.name }.toSet())
            assertEquals(4, client.callTool("explore_area", mapOf("place" to "45.7605,4.8597", "modes" to listOf("TRANSIT"))).data(AreaResult.serializer()).totalRoutes)
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
    fun `reachability geocodes its origin in the requested language`() {
        val motis = transitous()
        withMcpClient(motis) { client ->
            client.callTool("reachability", mapOf("place" to "Lyon Part-Dieu", "language" to "fr"))

            assertEquals("fr", motis.request("/api/v1/geocode").url.parameters["language"])
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
            val (request, nearby) = motis.requests.filter { it.url.encodedPath == "/api/v6/stoptimes" }
            assertEquals("true", request.url.parameters["arriveBy"])
            assertEquals("CURSOR", request.url.parameters["pageCursor"])
            assertEquals("HIGHSPEED_RAIL", request.url.parameters["mode"])
            assertEquals("true", request.url.parameters["fetchStops"])
            assertNull(request.url.parameters["radius"])
            // the trains of the other stops of the station, with the same filter and cursor
            assertEquals("200", nearby.url.parameters["radius"])
            assertEquals("HIGHSPEED_RAIL", nearby.url.parameters["mode"])
            assertEquals("CURSOR", nearby.url.parameters["pageCursor"])
            assertTrue(motis.requests.none { it.url.encodedPath == "/api/v1/geocode" })
            val text = result.text()
            assertTrue(text.startsWith("Arrivals at Lyon Part Dieu (stopId="), text)
            assertTrue(text.contains("HIGHSPEED_RAIL TGV INOUI 6633"), text)
            val first = result.data(DeparturesResult.serializer()).stopTimes.first()
            assertEquals("6633", first.trainNumber)
            // previous stops of an arrival
            assertEquals(listOf(StopCallDto("Paris Gare de Lyon Hall 1 - 2", "2026-10-12T19:00:00Z")), first.stops)
        }
    }

    @Test
    fun `departures of buses only do not look for the trains around the stop`() {
        val motis = transitous()
        withMcpClient(motis) { client ->
            val result = client.callTool("departures", mapOf("stopId" to "es-RENFE-Larga-Distancia-y-AVE_87303", "modes" to listOf("BUS")))

            assertNull(result.isError, result.text())
            assertEquals(1, motis.requests.count { it.url.encodedPath == "/api/v6/stoptimes" })
        }
    }

    @Test
    fun `first page of departures of a railway station lists the lines of the station`() {
        val motis = transitous()
        withMcpClient(motis) { client ->
            val result = client.callTool("departures", mapOf("stopId" to "es-RENFE-Larga-Distancia-y-AVE_87303"))

            val probes = motis.requests.filter { it.url.parameters["fetchStops"] == "false" }
            // concurrent requests, in any order
            assertEquals(
                setOf(
                    listOf("HIGHSPEED_RAIL", "LONG_DISTANCE", "NIGHT_RAIL"),
                    listOf("REGIONAL_FAST_RAIL", "REGIONAL_RAIL", "SUBURBAN"),
                    listOf("SUBWAY", "METRO"),
                    listOf("TRAM"),
                    listOf("BUS", "COACH"),
                ),
                probes.map { it.url.parameters["mode"]!!.split(",") }.toSet(),
            )
            assertTrue(probes.all { it.url.parameters["radius"] == "200" && it.url.parameters["n"] == "40" && it.url.parameters["pageCursor"] == null })
            assertEquals(
                listOf(StationLineDto("HIGHSPEED_RAIL", "TGV INOUI", "SNCF VOYAGEURS")),
                result.data(DeparturesResult.serializer()).stationLines?.map { it.copy(routeColor = null, routeTextColor = null) },
            )
            assertTrue(result.text().endsWith("- HIGHSPEED_RAIL: TGV INOUI (SNCF VOYAGEURS)"), result.text())
        }
    }

    @Test
    fun `departures of lines of a station read the pages of the station until enough stop times`() {
        val motis = transitous()
        withMcpClient(motis) { client ->
            val result =
                client.callTool(
                    "departures",
                    mapOf("stopId" to "es-RENFE-Larga-Distancia-y-AVE_87303", "station" to true, "lines" to listOf("TGV INOUI"), "count" to 5),
                )

            val requests = motis.requests.filter { it.url.encodedPath == "/api/v6/stoptimes" }
            // the same 3 trains on each page of the fixture: 4 pages read, without the probes of the station lines
            assertEquals(4, requests.size)
            assertTrue(requests.all { it.url.parameters["radius"] == "200" && it.url.parameters["fetchStops"] == "true" })
            assertEquals(listOf(null, "LATER|1791864300", "LATER|1791864300", "LATER|1791864300"), requests.map { it.url.parameters["pageCursor"] })
            val data = result.data(DeparturesResult.serializer())
            assertEquals(listOf("6633", "9852", "6602"), data.stopTimes.map { it.trainNumber })
            assertNull(data.stationLines)
        }
    }

    @Test
    fun `departures of other lines of a station`() {
        val motis = transitous()
        withMcpClient(motis) { client ->
            val result =
                client.callTool(
                    "departures",
                    mapOf("stopId" to "es-RENFE-Larga-Distancia-y-AVE_87303", "station" to true, "lines" to listOf("A"), "pageCursor" to "EARLIER|1"),
                )

            assertEquals(emptyList(), result.data(DeparturesResult.serializer()).stopTimes)
            val cursors = motis.requests.filter { it.url.encodedPath == "/api/v6/stoptimes" }.map { it.url.parameters["pageCursor"] }
            assertEquals(listOf("EARLIER|1", "EARLIER|1791839700", "EARLIER|1791839700", "EARLIER|1791839700"), cursors)
        }
    }

    @Test
    fun `departures of a station without lines filter`() {
        val motis = transitous()
        withMcpClient(motis) { client ->
            val result = client.callTool("departures", mapOf("stopId" to "es-RENFE-Larga-Distancia-y-AVE_87303", "station" to true))

            assertEquals(3, result.data(DeparturesResult.serializer()).stopTimes.size)
            assertEquals(1, motis.requests.count { it.url.encodedPath == "/api/v6/stoptimes" })
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
    fun `departures of an unknown stop id are a tool error`() {
        val motis = MockMotis { respondJson("""{"error":"no radius: stop_found=false, center_parsed=false"}""", HttpStatusCode.BadRequest) }
        withMcpClient(motis) { client ->
            val result = client.callTool("departures", mapOf("stopId" to "fr-horaires-sncf_XXX"))

            assertEquals(true, result.isError)
            assertEquals(
                "Unknown stop id \"fr-horaires-sncf_XXX\": get a valid one from search_places or explore_area, or give the stop name in 'stop'.",
                result.text(),
            )
        }
    }

    @Test
    fun `departures of an unknown stop id fall back to the stop name`() {
        val motis =
            MockMotis { request ->
                if (request.url.encodedPath == "/api/v6/stoptimes" && request.url.parameters["stopId"] == "fr-horaires-sncf_XXX") {
                    respondJson("""{"error":"no radius: stop_found=false, center_parsed=false"}""", HttpStatusCode.BadRequest)
                } else {
                    respondJson(fixture(FIXTURES.getValue(request.url.encodedPath)))
                }
            }
        withMcpClient(motis) { client ->
            val result = client.callTool("departures", mapOf("stopId" to "fr-horaires-sncf_XXX", "stop" to "Lyon Part-Dieu"))

            assertNull(result.isError, result.text())
            assertEquals(
                listOf("fr-horaires-sncf_XXX", "es-RENFE-Larga-Distancia-y-AVE_87303"),
                motis.requests
                    .filter { it.url.encodedPath == "/api/v6/stoptimes" && it.url.parameters["radius"] == null }
                    .map { it.url.parameters["stopId"] },
            )
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
            assertEquals("false", request.url.parameters["useRoutedTransfers"])
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
    fun `plan_journey sends the journey options to MOTIS`() {
        val motis = transitous()
        withMcpClient(motis) { client ->
            val result =
                client.callTool(
                    "plan_journey",
                    mapOf(
                        "from" to "45.7605,4.8597",
                        "to" to "Lyon Part-Dieu",
                        "walkingSpeed" to "slow",
                        "wheelchair" to true,
                        "transferMargin" to "COMFORTABLE",
                        "bike" to "ON_BOARD",
                    ),
                )

            val parameters = motis.request("/api/v6/plan").url.parameters
            assertEquals("0.8", parameters["pedestrianSpeed"])
            assertEquals("WHEELCHAIR", parameters["pedestrianProfile"])
            assertEquals("5", parameters["additionalTransferTime"])
            assertEquals("true", parameters["requireBikeTransport"])
            assertEquals("BIKE", parameters["preTransitModes"])
            assertEquals("BIKE", parameters["postTransitModes"])
            assertEquals("BIKE", parameters["directModes"])
            // the bike is ridden from/to coordinates: the destination stop is sent as its coordinates
            assertTrue(MotisGateway.parseCoordinates(parameters["toPlace"]!!) != null, parameters["toPlace"])
            assertTrue(
                result.text().contains("Options: walking speed SLOW, wheelchair, transfer margin COMFORTABLE, bike ON_BOARD."),
                result.text(),
            )
        }
    }

    @Test
    fun `plan_journey rides the bike from the origin only to a station`() {
        val motis = transitous()
        withMcpClient(motis) { client ->
            client.callTool("plan_journey", mapOf("from" to "45.7605,4.8597", "to" to "Lyon Part-Dieu", "bike" to "TO_STATION"))

            val parameters = motis.request("/api/v6/plan").url.parameters
            assertEquals("es-RENFE-Larga-Distancia-y-AVE_87303", parameters["toPlace"])
            assertEquals("BIKE", parameters["preTransitModes"])
            assertEquals("WALK", parameters["postTransitModes"])
            assertEquals("WALK,BIKE", parameters["directModes"])
            assertEquals("false", parameters["requireBikeTransport"])
            assertNull(parameters["pedestrianSpeed"])
            assertNull(parameters["pedestrianProfile"])
        }
    }

    @Test
    fun `plan_journey rejects unknown option values`() {
        withMcpClient(MockMotis { error("no MOTIS call expected") }) { client ->
            val result = client.callTool("plan_journey", mapOf("from" to "Lyon", "to" to "Grenoble", "bike" to "TANDEM"))

            assertEquals(true, result.isError)
            assertEquals("Invalid argument: 'bike' must be one of NONE, TO_STATION, ON_BOARD", result.text())
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
    fun `plan_journey starts from the position of the user and searches the destination near the origin`() {
        val motis = transitous()
        withMcpClient(motis) { client ->
            val result = client.callTool("plan_journey", mapOf("position" to "45.7605,4.8597", "to" to "Lyon Part-Dieu", "language" to "fr"))

            assertNull(result.isError, result.text())
            assertEquals("45.7605,4.8597", motis.request("/api/v6/plan").url.parameters["fromPlace"])
            val geocode = motis.request("/api/v1/geocode").url.parameters
            assertEquals("45.7605,4.8597", geocode["place"])
            assertEquals("fr", geocode["language"])
        }
    }

    @Test
    fun `plan_journey searches the origin near the position of the user`() {
        val motis = transitous()
        withMcpClient(motis) { client ->
            client.callTool("plan_journey", mapOf("from" to "Lyon Part-Dieu", "to" to "45.19,5.71", "position" to "45.75,4.85"))

            assertEquals("45.75,4.85", motis.request("/api/v1/geocode").url.parameters["place"])
            assertEquals("es-RENFE-Larga-Distancia-y-AVE_87303", motis.request("/api/v6/plan").url.parameters["fromPlace"])
        }
    }

    @Test
    fun `plan_journey requires an origin`() {
        withMcpClient(MockMotis { error("no MOTIS call expected") }) { client ->
            val missing = client.callTool("plan_journey", mapOf("to" to "Grenoble"))
            assertEquals("Invalid argument: 'from' or 'position' is required", missing.text())

            val invalid = client.callTool("plan_journey", mapOf("position" to "Lyon", "to" to "Grenoble"))
            assertEquals("Invalid argument: 'position' must be 'lat,lon'", invalid.text())
        }
    }

    @Test
    fun `stop ids are resolved as stops, as the geocoder does not search them`() {
        val stopId = "es-RENFE-Larga-Distancia-y-AVE_87303"
        val motis =
            MockMotis { request ->
                when (request.url.encodedPath) {
                    "/api/v1/geocode" -> respondJson("[]")
                    else -> respondJson(fixture(FIXTURES.getValue(request.url.encodedPath)))
                }
            }
        withMcpClient(motis) { client ->
            val result = client.callTool("plan_journey", mapOf("from" to stopId, "to" to "45.19,5.71"))

            assertNull(result.isError, result.text())
            assertEquals(stopId, motis.request("/api/v6/plan").url.parameters["fromPlace"])
            assertEquals(stopId, motis.request("/api/v6/stoptimes").url.parameters["stopId"])
        }
    }

    @Test
    fun `unknown stop ids are tool errors`() {
        val motis =
            MockMotis { request ->
                when (request.url.encodedPath) {
                    "/api/v1/geocode" -> respondJson("[]")
                    else -> respondJson("""{"error":"unknown feed id \"nope\""}""", HttpStatusCode.NotFound)
                }
            }
        withMcpClient(motis) { client ->
            val result = client.callTool("reachability", mapOf("place" to "nope_123"))

            assertEquals(true, result.isError)
            assertEquals("No place found for \"nope_123\"", result.text())
        }
    }

    @Test
    fun `plan_journey tells the area of the places asked by name`() {
        val match =
            """
            [{"id":"bordeaux","name":"Saint Michel","type":"STOP","lat":44.834,"lon":-0.563,"score":-21.85,
              "areas":[{"name":"Bordeaux","adminLevel":8,"matched":false,"default":true}],"tokens":[]}]
            """.trimIndent()
        val motis =
            MockMotis { request ->
                when (request.url.encodedPath) {
                    "/api/v1/geocode" -> respondJson(match)
                    else -> respondJson(fixture(FIXTURES.getValue(request.url.encodedPath)))
                }
            }
        withMcpClient(motis) { client ->
            val result = client.callTool("plan_journey", mapOf("from" to "Saint-Michel", "to" to "45.19,5.71"))

            val journey = result.data(JourneyResult.serializer())
            assertEquals("Bordeaux", journey.from.area)
            assertNull(journey.to.area)
            assertTrue(result.text().startsWith("From Saint Michel (Bordeaux) to 45.19,5.71: "), result.text())
        }
    }

    @Test
    fun `ambiguous places are tool errors listing the candidates`() {
        // homonyms in different cities with the same score, and a platform of the best match (not a rival)
        val matches =
            """
            [
              {"id":"bordeaux","name":"Saint Michel","type":"STOP","lat":44.834,"lon":-0.563,"score":-21.85,"areas":[{"name":"Bordeaux","adminLevel":8,"matched":false,"default":true}],"tokens":[]},
              {"id":"bordeaux-2","name":"Saint Michel","type":"STOP","lat":44.835,"lon":-0.564,"score":-21.85,"areas":[],"tokens":[]},
              {"id":"bourges","name":"Saint Michel","type":"STOP","lat":47.105,"lon":2.424,"score":-21.5,"areas":[{"name":"Bourges","adminLevel":8,"matched":false,"default":true}],"tokens":[]},
              {"id":"paris","name":"Saint-Michel Notre-Dame","type":"STOP","lat":48.853,"lon":2.344,"score":-20.0,"areas":[],"tokens":[]}
            ]
            """.trimIndent()
        val motis = MockMotis { respondJson(matches) }
        withMcpClient(motis) { client ->
            val result = client.callTool("departures", mapOf("stop" to "Saint-Michel"))

            assertEquals(true, result.isError)
            assertEquals(
                """
                "Saint-Michel" is ambiguous, candidates:
                - Saint Michel — Bordeaux id=bordeaux (44.834,-0.563)
                - Saint Michel — Bourges id=bourges (47.105,2.424)
                Retry with one of these stop ids or coordinates, or a more precise name (e.g. with the city).
                """.trimIndent(),
                result.text(),
            )
            assertEquals("5", motis.request("/api/v1/geocode").url.parameters["numResults"])
        }
    }

    @Test
    fun `MOTIS failures without error body are tool errors`() {
        withMcpClient(MockMotis { respondJson("oops", HttpStatusCode.InternalServerError) }) { client ->
            val result = client.callTool("trip_details", mapOf("tripId" to "trip"))

            assertEquals(true, result.isError)
            assertEquals("MOTIS server unreachable or invalid response: retry in a moment", result.text())
        }
    }

    @Test
    fun `network errors are tool errors asking to retry`() {
        withMcpClient(MockMotis { throw java.io.IOException("connection reset") }) { client ->
            val result = client.callTool("trip_details", mapOf("tripId" to "trip"))

            assertEquals(true, result.isError)
            assertEquals("MOTIS server unreachable or invalid response: retry in a moment", result.text())
        }
    }

    @Test
    fun `transient HTTP statuses are tool errors asking to retry`() {
        withMcpClient(MockMotis { respondJson("", HttpStatusCode.ServiceUnavailable) }) { client ->
            val result = client.callTool("trip_details", mapOf("tripId" to "trip"))

            assertEquals(true, result.isError)
            assertEquals("MOTIS server temporarily unavailable (HTTP status 503): retry in a moment", result.text())
        }
        withMcpClient(MockMotis { respondJson("", HttpStatusCode.TooManyRequests) }) { client ->
            val result = client.callTool("trip_details", mapOf("tripId" to "trip"))

            assertEquals("MOTIS server rate limit reached: retry in a minute", result.text())
        }
    }
}
