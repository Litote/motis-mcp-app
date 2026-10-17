package org.litote.motis.mcp

import kotlin.test.Test
import kotlin.test.assertEquals

class BoundingBoxTest {
    @Test
    fun `the radius of an area around a place is the requested one`() {
        assertEquals(1.5, BoundingBox.around(45.76, 4.86, 1.5).radiusKm, 0.001)
    }

    @Test
    fun `the radius of an area is half of its largest side`() {
        // 0.1° of latitude (11 km) by 1° of longitude at 45°N (79 km)
        assertEquals(39.4, BoundingBox(45.0, 4.0, 45.1, 5.0).radiusKm, 0.1)
        assertEquals(5.6, BoundingBox(45.0, 4.0, 45.1, 4.01).radiusKm, 0.1)
    }
}
