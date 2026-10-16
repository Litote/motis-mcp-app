package org.litote.motis.mcp.dto

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class LineNameTest {
    @Test
    fun `the short name is preferred`() {
        assertEquals("T1", routeName("T1", "IUT Feyssine - Debourg"))
        assertEquals("IUT Feyssine - Debourg", routeName("", "IUT Feyssine - Debourg"))
    }

    @Test
    fun `station codes are replaced by the long name`() {
        assertEquals("Bruxelles-Midi -> Bourg-St-Maurice", routeName("BEBMI -> FRQBM", "Bruxelles-Midi -> Bourg-St-Maurice"))
        assertEquals("Bruxelles-Midi -> Bourg-St-Maurice", lineName(listOf("BEBMI -> FRQBM", "BEBMI -> FRQBM"), "Bruxelles-Midi -> Bourg-St-Maurice"))
        // better codes than nothing
        assertEquals("BEBMI -> FRQBM", routeName("BEBMI -> FRQBM", ""))
        // a display name is kept
        assertEquals("EST 9311", lineName(listOf("EST 9311", "BEBMI -> FRQBM"), "Bruxelles-Midi -> Bourg-St-Maurice"))
        assertNull(lineName(listOf(null, ""), null))
    }
}
