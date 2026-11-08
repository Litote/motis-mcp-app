package org.litote.motis.mcp.apps

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.litote.motis.mcp.MapTiles
import org.litote.motis.mcp.RailOverlay
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AppResourcesTest {
    @Test
    fun `the dedicated origin of the views is requested when configured`() {
        val ui = resourceMeta(MapTiles(), "https://motis.example.org").getValue("ui").jsonObject
        assertEquals("https://motis.example.org", ui.getValue("domain").jsonPrimitive.content)
        assertNull(resourceMeta(MapTiles()).getValue("ui").jsonObject["domain"])
    }

    @Test
    fun `the bundled views get the tiles`() {
        val views = loadViews(MapTiles())

        views.values.forEach { assertTrue(it.contains("<script type=\"application/json\" id=\"motis-map\">{\"tiles\":{\"url\":\"${MapTiles.OSM_URL}\"")) }
    }

    @Test
    fun `the tiles are injected once in each view, without closing the script element`() {
        val tiles = MapTiles(url = "https://{s}.tiles.example.org/{z}/{x}/{y}.png", attribution = "<b>Tiles & co</b></script>")

        val views = loadViews(tiles) { "<html><head></head><body>${it.name}</body></html>" }

        assertEquals(UiView.entries.toSet(), views.keys)
        assertEquals(
            "<html><head><script type=\"application/json\" id=\"motis-map\">" +
                "{\"tiles\":{\"url\":\"https://{s}.tiles.example.org/{z}/{x}/{y}.png\"," +
                "\"attribution\":\"\\u003cb>Tiles & co\\u003c/b>\\u003c/script>\"},\"railOverlays\":[]}" +
                "</script></head><body>EXPLORER</body></html>",
            views.getValue(UiView.EXPLORER),
        )
        // the escaped JSON is still the configuration
        val json = views.getValue(UiView.EXPLORER).substringAfter("id=\"motis-map\">").substringBefore("</script>")
        assertEquals(mapConfig(tiles), Json.parseToJsonElement(json))
    }

    @Test
    fun `the rail overlays are configured, and their origins allowed by the CSP`() {
        val tiles = MapTiles(railOverlays = listOf(RailOverlay.IGN, RailOverlay.OPENRAILWAYMAP))

        val overlays = mapConfig(tiles).getValue("railOverlays").jsonArray.map { it.jsonObject }
        assertEquals(listOf("france", "world"), overlays.map { it.getValue("area").jsonPrimitive.content })
        assertEquals(RailOverlay.IGN.url, overlays[0].getValue("url").jsonPrimitive.content)
        assertEquals(6, overlays[0].getValue("minZoom").jsonPrimitive.int)
        assertEquals(18, overlays[0].getValue("maxNativeZoom").jsonPrimitive.int)

        val csp = resourceMeta(tiles).getValue("ui").jsonObject.getValue("csp").jsonObject
        val origins = listOf("https://tile.openstreetmap.org", "https://data.geopf.fr", "https://tiles.openrailwaymap.org")
        assertEquals(origins, csp.getValue("resourceDomains").jsonArray.map { it.jsonPrimitive.content })
        assertEquals(origins, csp.getValue("connectDomains").jsonArray.map { it.jsonPrimitive.content })
    }

    @Test
    fun `the origins of the tiles are deduplicated, subdomains as a wildcard`() {
        val tiles = MapTiles(url = "https://{s}.tiles.example.org/{z}/{x}/{y}.png")
        assertEquals(listOf("https://*.tiles.example.org"), tiles.origins)
        assertEquals(listOf("https://tile.openstreetmap.org"), MapTiles(url = "https://tile.openstreetmap.org/a/{z}/{x}/{y}.png").origins)
    }
}
