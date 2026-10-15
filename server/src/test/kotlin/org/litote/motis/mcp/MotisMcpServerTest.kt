package org.litote.motis.mcp

import io.ktor.http.HttpStatusCode
import io.modelcontextprotocol.kotlin.sdk.types.ReadResourceRequest
import io.modelcontextprotocol.kotlin.sdk.types.ReadResourceRequestParams
import io.modelcontextprotocol.kotlin.sdk.types.TextContent
import io.modelcontextprotocol.kotlin.sdk.types.TextResourceContents
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.litote.motis.mcp.apps.MCP_APP_MIME_TYPE
import org.litote.motis.mcp.apps.UiView
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val GEOCODE_PART_DIEU =
    """[{"type":"STOP","id":"fr-lyon-tcl_S5520","name":"Gare Part-Dieu V.Merle","lat":45.7615,"lon":4.8578,
       "score":10.0,"tokens":[],"areas":[{"name":"Lyon","adminLevel":8.0,"matched":true,"default":true}],"modes":["SUBWAY"]}]"""

private const val STOP_TIMES =
    """{"place":{"name":"Gare Part-Dieu V.Merle","stopId":"fr-lyon-tcl_S5520","lat":45.7615,"lon":4.8578,"tz":"Europe/Paris"},
       "nextPageCursor":"NEXT","previousPageCursor":"",
       "stopTimes":[{"place":{"name":"Gare Part-Dieu V.Merle","lat":45.7615,"lon":4.8578,"track":"1",
                             "departure":"2026-10-09T18:57:00Z","scheduledDeparture":"2026-10-09T18:51:00Z"},
                     "mode":"TRAM","realTime":true,"headsign":"Debourg","tripFrom":{"name":"IUT Feyssine","lat":45.78,"lon":4.87},
                     "tripTo":{"name":"Debourg","lat":45.73,"lon":4.83},"agencyId":"tcl","agencyName":"TCL","agencyUrl":"https://tcl.fr",
                     "routeId":"T1","routeShortName":"T1","routeLongName":"IUT Feyssine - Debourg","routeColor":"0055A4",
                     "directionId":"0","tripId":"trip-1","tripShortName":"","displayName":"T1","source":"tcl",
                     "cancelled":false,"tripCancelled":false}]}"""

class MotisMcpServerTest {
    @Test
    fun `ui tools reference a registered MCP App view`() {
        withMcpClient(MockMotis { error("no MOTIS call expected") }) { client ->
            val tools = client.listTools().tools.associateBy { it.name }
            assertEquals(
                setOf(
                    "search_places", "server_info", "explore_area", "route_details", "reachability",
                    "departures", "trip_details", "plan_journey", "rentals",
                ),
                tools.keys,
            )
            val viewUris = UiView.entries.map { it.uri }.toSet()
            val toolUris = tools.values.mapNotNull { it.meta?.get("ui")?.jsonObject?.get("resourceUri")?.jsonPrimitive?.content }
            assertEquals(viewUris, toolUris.toSet())
            assertEquals(UiView.DEPARTURES.uri, tools.getValue("departures").meta?.get("ui/resourceUri")?.jsonPrimitive?.content)
            assertNull(tools.getValue("search_places").meta)
            assertTrue(tools.values.all { it.annotations?.readOnlyHint == true })
        }
    }

    @Test
    fun `views are html resources with the tiles CSP and configuration`() {
        withMcpClient(MockMotis { error("no MOTIS call expected") }) { client ->
            val resource = client.listResources().resources.single { it.uri == UiView.EXPLORER.uri }
            assertEquals(MCP_APP_MIME_TYPE, resource.mimeType)
            val csp = resource.meta?.get("ui")?.jsonObject?.get("csp")?.jsonObject
            assertEquals("https://tile.openstreetmap.org", csp?.get("resourceDomains")?.jsonArray?.single()?.jsonPrimitive?.content)
            // default sandbox origin of the host
            assertNull(resource.meta?.get("ui")?.jsonObject?.get("domain"))

            val content =
                client.readResource(ReadResourceRequest(ReadResourceRequestParams(UiView.EXPLORER.uri))).contents.single()
                    as TextResourceContents
            assertEquals(MCP_APP_MIME_TYPE, content.mimeType)
            assertTrue(content.text.contains("""<meta name="motis-tiles" content="https://tile.openstreetmap.org/{z}/{x}/{y}.png""""))
            assertTrue(content.text.contains("EXPLORER"))
        }
    }

    @Test
    fun `departures resolves the stop name and returns the board`() {
        val motis =
            MockMotis { request ->
                when (request.url.encodedPath) {
                    "/api/v1/geocode" -> respondJson(GEOCODE_PART_DIEU)
                    "/api/v6/stoptimes" -> respondJson(STOP_TIMES)
                    else -> error("unexpected ${request.url}")
                }
            }
        withMcpClient(motis) { client ->
            val result = client.callTool("departures", mapOf("stop" to "Part-Dieu", "count" to 5))

            assertNull(result.isError)
            val geocode = motis.requests.first { it.url.encodedPath == "/api/v1/geocode" }
            assertEquals("STOP", geocode.url.parameters["type"])
            val stopTimes = motis.requests.single { it.url.encodedPath == "/api/v6/stoptimes" }
            assertEquals("fr-lyon-tcl_S5520", stopTimes.url.parameters["stopId"])
            assertEquals("5", stopTimes.url.parameters["n"])

            val board = assertNotNull(result.structuredContent)
            assertEquals("departures", board["kind"]?.jsonPrimitive?.content)
            assertEquals("NEXT", board["nextPageCursor"]?.jsonPrimitive?.content)
            assertNull(board["previousPageCursor"])
            val departure = board["stopTimes"]!!.jsonArray.single().jsonObject
            assertEquals("T1", departure["line"]?.jsonPrimitive?.content)
            assertEquals("#0055A4", departure["routeColor"]?.jsonPrimitive?.content)
            assertEquals("2026-10-09T18:57:00Z", departure["time"]?.jsonPrimitive?.content)

            // times in the summary are local to the stop
            val text = (result.content.single() as TextContent).text
            assertTrue(text.contains("20:57 (scheduled 20:51) TRAM T1 → Debourg track 1"), text)
        }
    }

    @Test
    fun `rentals keeps area-wide virtual stations out of the stations, closest first`() {
        val rentals = MotisMcpServerTest::class.java.getResource("/rentals-paris.json")!!.readText()
        val motis =
            MockMotis { request ->
                when (request.url.encodedPath) {
                    "/api/v1/rentals" -> respondJson(rentals)
                    else -> error("unexpected ${request.url}")
                }
            }
        withMcpClient(motis) { client ->
            val result = client.callTool("rentals", mapOf("place" to "48.8586,2.3470", "radiusKm" to 1.5))

            assertNull(result.isError)
            val data = assertNotNull(result.structuredContent)
            // "Paris Proper" (5556 vehicles of Lime located at one point) is not a station
            val stations = data["stations"]!!.jsonArray.map { it.jsonObject }
            assertEquals(listOf("Victoria - Place du Chatelet", "Ventadour - Opéra"), stations.map { it["name"]?.jsonPrimitive?.content })
            assertEquals(2, data["totalStations"]?.jsonPrimitive?.content?.toInt())
            // MOTIS reports no docks: none rather than 0
            assertNull(stations.first()["docksAvailable"])
            val lime = data["providers"]!!.jsonArray.map { it.jsonObject }.single { it["id"]?.jsonPrimitive?.content == "fr-gbfs-paris-1" }
            assertEquals(0, lime["stations"]?.jsonPrimitive?.content?.toInt())
            assertEquals(5556, lime["areaVehicles"]?.jsonPrimitive?.content?.toInt())

            val text = (result.content.single() as TextContent).text
            assertTrue(text.contains("5556 vehicle(s) reported for its whole service area (not located)"), text)
            assertTrue(text.contains("Nearest stations with vehicles:\n- Victoria - Place du Chatelet"), text)
            // no total of stations: docking stations and parking spots are not added up
            assertTrue(text.lines().first().endsWith(": 2 provider(s)."), text)
        }
    }

    @Test
    fun `MOTIS errors are returned as tool errors`() {
        val motis = MockMotis { respondJson("""{"error":"unknown stop"}""", HttpStatusCode.BadRequest) }
        withMcpClient(motis) { client ->
            val result = client.callTool("departures", mapOf("stopId" to "nope"))

            assertEquals(true, result.isError)
            assertEquals("MOTIS error: unknown stop", (result.content.single() as TextContent).text)
        }
    }

    @Test
    fun `invalid arguments are returned as tool errors without calling MOTIS`() {
        val motis = MockMotis { error("no MOTIS call expected") }
        withMcpClient(motis) { client ->
            val result = client.callTool("plan_journey", mapOf("from" to "45.76,4.86", "to" to "45.19,5.71", "time" to "tomorrow"))

            assertEquals(true, result.isError)
            assertTrue((result.content.single() as TextContent).text.startsWith("Invalid argument: 'time'"))
            assertTrue(motis.requests.isEmpty())
        }
    }
}
