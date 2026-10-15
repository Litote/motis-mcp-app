package org.litote.motis.mcp.apps

import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.litote.motis.mcp.MapTiles
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class AppResourcesTest {
    @Test
    fun `the dedicated origin of the views is requested when configured`() {
        val ui = resourceMeta(MapTiles(), "https://motis.example.org").getValue("ui").jsonObject
        assertEquals("https://motis.example.org", ui.getValue("domain").jsonPrimitive.content)
        assertNull(resourceMeta(MapTiles()).getValue("ui").jsonObject["domain"])
    }
}
