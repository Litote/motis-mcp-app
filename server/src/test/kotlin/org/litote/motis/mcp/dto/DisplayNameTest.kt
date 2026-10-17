package org.litote.motis.mcp.dto

import kotlin.test.Test
import kotlin.test.assertEquals

class DisplayNameTest {
    @Test
    fun `names in capitals get the mixed case`() {
        assertEquals("Lyon Perrache", displayName("LYON PERRACHE"))
        assertEquals("Paris Gare de Lyon", displayName("PARIS GARE DE LYON"))
        assertEquals("Milano Porta Garibaldi", displayName("MILANO PORTA GARIBALDI"))
        assertEquals("Saint-Germain-en-Laye", displayName("SAINT-GERMAIN-EN-LAYE"))
        assertEquals("La Rochelle Ville", displayName("LA ROCHELLE VILLE"))
        assertEquals("L'Isle d'Abeau", displayName("L'ISLE D'ABEAU"))
        assertEquals("Chambéry Challes-les-Eaux", displayName("CHAMBÉRY CHALLES-LES-EAUX"))
        assertEquals("Lyon St Exupéry TGV", displayName("LYON ST EXUPÉRY TGV"))
        assertEquals("Aéroport CDG 2", displayName("AÉROPORT CDG 2"))
        assertEquals("L’Isle d’Abeau", displayName("L’ISLE D’ABEAU"))
        assertEquals("Mt Blanc Terminal B", displayName("MT BLANC TERMINAL B"))
        // a single letter is a word, not an elision, without apostrophe
        assertEquals("Lyon A Gare", displayName("LYON A GARE"))
        assertEquals("Terminal B", displayName("TERMINAL B"))
    }

    @Test
    fun `names in mixed case and numbers are kept`() {
        assertEquals("Lyon Perrache", displayName("Lyon Perrache"))
        assertEquals("Gare Part-Dieu V.Merle", displayName("Gare Part-Dieu V.Merle"))
        assertEquals("847459", displayName("847459"))
        assertEquals("A", displayName("A"))
    }
}
