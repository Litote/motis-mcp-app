package org.litote.motis.mcp.apps

import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.litote.motis.mcp.MapTiles
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

        views.values.forEach { assertTrue(it.contains("<meta name=\"motis-tiles\" content=\"${MapTiles.OSM_URL}\"")) }
    }

    @Test
    fun `the tiles are injected once in each view`() {
        val tiles = MapTiles(url = "https://{s}.tiles.example.org/{z}/{x}/{y}.png", attribution = "<b>Tiles & co</b>")

        val views = loadViews(tiles) { "<html><head></head><body>${it.name}</body></html>" }

        assertEquals(UiView.entries.toSet(), views.keys)
        assertEquals(
            "<html><head><meta name=\"motis-tiles\" content=\"https://{s}.tiles.example.org/{z}/{x}/{y}.png\" " +
                "data-attribution=\"&lt;b&gt;Tiles &amp; co&lt;/b&gt;\" /></head><body>EXPLORER</body></html>",
            views.getValue(UiView.EXPLORER),
        )
    }
}
