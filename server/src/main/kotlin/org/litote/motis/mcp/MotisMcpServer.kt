package org.litote.motis.mcp

import io.modelcontextprotocol.kotlin.sdk.server.Server
import io.modelcontextprotocol.kotlin.sdk.server.ServerOptions
import io.modelcontextprotocol.kotlin.sdk.types.Implementation
import io.modelcontextprotocol.kotlin.sdk.types.ServerCapabilities
import org.litote.motis.mcp.apps.UiView
import org.litote.motis.mcp.apps.addAppResources
import org.litote.motis.mcp.apps.loadView
import org.litote.motis.mcp.tools.addAreaTools
import org.litote.motis.mcp.tools.addPlaceTools
import org.litote.motis.mcp.tools.addRentalTools
import org.litote.motis.mcp.tools.addRoutingTools
import org.litote.motis.mcp.tools.addTimetableTools

private val INSTRUCTIONS =
    """
    Explore the public transport data of a MOTIS server (by default Transitous, which aggregates open GTFS,
    GTFS-RT and GBFS feeds worldwide).
    - search_places: find stops/addresses and their ids.
    - explore_area / route_details: stops and lines available around a place (map).
    - departures / trip_details: timetables and real-time departures of a stop.
    - plan_journey: itineraries between two places; reachability: isochrone from a place.
    - rentals: shared bikes, scooters and cars.
    - server_info: server version and capabilities.
    Places can be given by name: they are geocoded, the best match is used.
    Dates are ISO-8601 with offset; default is now.
    """.trimIndent()

/**
 * Creates the MCP server: tools calling MOTIS, and the MCP App views as `ui://` resources.
 *
 * @param views HTML of the views, loaded once and shared by every server instance
 * @param viewDomain dedicated origin of the views (`_meta.ui.domain`), null: the default of the host
 */
fun createMotisMcpServer(
    gateway: MotisGateway,
    baseUrl: String,
    tiles: MapTiles = MapTiles(),
    views: Map<UiView, String> = loadViews(),
    viewDomain: String? = null,
): Server =
    Server(
        serverInfo = Implementation(name = APP_NAME, version = APP_VERSION, title = "MOTIS explorer"),
        options =
            ServerOptions(
                capabilities =
                    ServerCapabilities(
                        tools = ServerCapabilities.Tools(listChanged = false),
                        resources = ServerCapabilities.Resources(listChanged = false, subscribe = false),
                    ),
            ),
        instructions = INSTRUCTIONS,
    ).apply {
        addAppResources(tiles, viewDomain) { views.getValue(it) }
        addPlaceTools(gateway, baseUrl)
        addAreaTools(gateway)
        addTimetableTools(gateway)
        addRoutingTools(gateway)
        addRentalTools(gateway)
    }

fun loadViews(): Map<UiView, String> = UiView.entries.associateWith { loadView(it) }
