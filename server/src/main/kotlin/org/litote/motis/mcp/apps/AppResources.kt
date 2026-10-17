package org.litote.motis.mcp.apps

import io.modelcontextprotocol.kotlin.sdk.server.RegisteredResource
import io.modelcontextprotocol.kotlin.sdk.server.Server
import io.modelcontextprotocol.kotlin.sdk.types.ReadResourceResult
import io.modelcontextprotocol.kotlin.sdk.types.Resource
import io.modelcontextprotocol.kotlin.sdk.types.TextResourceContents
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import org.litote.motis.mcp.MapTiles

/** MIME type of MCP Apps HTML views (ext-apps specification). */
const val MCP_APP_MIME_TYPE = "text/html;profile=mcp-app"

/** Legacy flat `_meta` key for the view URI, still read by some hosts. */
private const val LEGACY_RESOURCE_URI_META_KEY = "ui/resourceUri"

/** Who can call a tool: the model, the view, or both (default). */
enum class ToolVisibility(val value: String) { MODEL("model"), APP("app") }

/**
 * MCP App views. Each one is a single HTML file bundled by Vite (`ui/`) and copied to the `ui/` classpath folder.
 */
enum class UiView(val file: String, val title: String, val description: String) {
    EXPLORER("explorer.html", "Map explorer", "Map of stops, routes and reachable places"),
    DEPARTURES("departures.html", "Departures board", "Departures/arrivals of a stop and trip details"),
    ITINERARY("itinerary.html", "Journey planner", "Itineraries between two places"),
    RENTALS("rentals.html", "Shared mobility", "Rental providers, stations and vehicles"),
    ;

    val uri: String get() = "ui://motis/$file"

    /** `_meta` of a tool rendered by this view. */
    fun toolMeta(visibility: List<ToolVisibility>? = null): JsonObject =
        buildJsonObject {
            putJsonObject("ui") {
                put("resourceUri", uri)
                visibility?.let { v -> putJsonArray("visibility") { v.forEach { add(it.value) } } }
            }
            put(LEGACY_RESOURCE_URI_META_KEY, uri)
        }
}

/**
 * `_meta` of the view resources: CSP allowing the map tiles (the only external origin), a host border, and the
 * dedicated origin of the views ([domain], format defined by each host) if any.
 */
internal fun resourceMeta(tiles: MapTiles, domain: String? = null): JsonObject =
    buildJsonObject {
        putJsonObject("ui") {
            putJsonObject("csp") {
                putJsonArray("resourceDomains") { add(tiles.origin) }
                putJsonArray("connectDomains") { add(tiles.origin) }
            }
            put("prefersBorder", true)
            domain?.let { put("domain", it) }
        }
    }

private fun String.escapeAttribute(): String =
    replace("&", "&amp;").replace("\"", "&quot;").replace("<", "&lt;").replace(">", "&gt;")

/** Adds the tile configuration to the view, read by `ui/src/shared/map.ts`. */
internal fun injectTiles(html: String, tiles: MapTiles): String =
    html.replaceFirst(
        "<head>",
        """<head><meta name="motis-tiles" content="${tiles.url.escapeAttribute()}" data-attribution="${tiles.attribution.escapeAttribute()}" />""",
    )

/** Reads the bundled HTML of [view] from the classpath. */
fun loadView(view: UiView): String =
    UiView::class.java.getResource("/ui/${view.file}")?.readText()
        ?: error("UI view ${view.file} not found in the classpath: run ./gradlew :server:buildUi")

/**
 * HTML of the views, with the configuration of the [tiles]: prepared once, as a server is created for each request in
 * stateless mode (about 1.7 MB of HTML).
 */
fun loadViews(tiles: MapTiles, load: (UiView) -> String = ::loadView): Map<UiView, String> =
    UiView.entries.associateWith { injectTiles(load(it), tiles) }

/** Registers every view as a `ui://` resource: [html] of [loadViews], CSP allowing the [tiles]. */
fun Server.addAppResources(tiles: MapTiles, domain: String? = null, html: (UiView) -> String) {
    val resourceMeta = resourceMeta(tiles, domain)
    addResources(
        UiView.entries.map { view ->
            val html = html(view)
            RegisteredResource(
                Resource(
                    uri = view.uri,
                    name = view.title,
                    description = view.description,
                    mimeType = MCP_APP_MIME_TYPE,
                    meta = resourceMeta,
                ),
            ) {
                ReadResourceResult(
                    listOf(TextResourceContents(text = html, uri = view.uri, mimeType = MCP_APP_MIME_TYPE, meta = resourceMeta)),
                )
            }
        },
    )
}
