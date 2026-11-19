package org.litote.motis.mcp.dto

import kotlin.test.Test
import kotlin.test.assertEquals

class LatLonTest {
    @Test
    fun `coordinates are written to 7 decimals without the noise of the doubles`() {
        assertEquals("48.88096,2.3556874", latLon(48.880959999999995, 2.3556873999999994))
        assertEquals("45.19298,5.7143", latLon(45.192980000000006, 5.7143))
        assertEquals("-33.8688,151", latLon(-33.8688, 151.0))
    }
}
