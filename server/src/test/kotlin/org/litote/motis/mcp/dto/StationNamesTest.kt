package org.litote.motis.mcp.dto

import kotlin.test.Test
import kotlin.test.assertEquals

class StationNamesTest {
    // uic, lat, lon, main, name, city, fr, es, en, nl, de, it
    private val stations =
        StationNames(
            listOf(
                "# comment",
                "8777500\t43.83229\t4.36585\t1\tNîmes Centre\tNîmes\t\tNimes Centre\t\t\t\t",
                "8775100\t43.30287\t5.38029\t1\tMarseille St-Charles\tMarseille\t\tMarsella St-Charles\t\tMarseille St-Charles\tMarseille St-Charles\tMarsiglia St-Charles",
                "7179300\t41.97952\t2.81648\t0\tGirona\tGirona\tGérone\tGerona\t\t\t\tGerona",
                "7171801\t41.37917\t2.14003\t1\tBarcelona Sants\tBarcelona\tBarcelone Sants\t\tBarcelona Sants\t\t\t",
                "8776100\t44.92\t4.89\t1\tValence Ville\tValence\t\tValencia Ville\t\t\t\t",
                "8776302\t44.99\t4.97\t0\tValence TGV\tValence\t\tValencia TGV\t\t\t\t",
                "8000207\t50.943\t6.959\t1\tKöln Hbf\tKöln\tCologne Hbf\tColonia Hbf\tCologne Hbf\tKeulen Hbf\t\tColonia Hbf",
            ).joinToString("\n"),
        )

    @Test
    fun `the city of a name is written in the language`() {
        assertEquals("Gérone", stations.localize("Girona", 41.9795, 2.8165, "fr"))
        assertEquals("Gerona", stations.localize("Girona", null, null, "es"))
        assertEquals("Girona", stations.localize("Girona", null, null, "en"))
        assertEquals("Barcelone Sants", stations.localize("Barcelona Sants", 41.3792, 2.1401, "fr"))
        assertEquals("Colonia Hbf", stations.localize("Köln Hbf", null, null, "it"))
        // the rest of the name is the feed's
        assertEquals("Marsella Hall 1 - 2", stations.localize("Marseille Hall 1 - 2", null, null, "es"))
    }

    @Test
    fun `a stop named after its city takes the name of its station`() {
        assertEquals("Nîmes Centre", stations.localize("Nimes", 43.8323, 4.3659, "fr"))
        assertEquals("Nîmes Centre", stations.localize("Nimes", null, null, "fr"))
        assertEquals("Nimes Centre", stations.localize("Nimes", null, null, "es"))
    }

    @Test
    fun `a stop named after its city and a word for station takes the name of its station`() {
        // the German feed names the station of Strasbourg "Strasbourg Bahnhof"
        assertEquals("Nîmes Centre", stations.localize("Nimes Bahnhof", 43.8323, 4.3659, "fr"))
        assertEquals("Nîmes Centre", stations.localize("Nîmes Gare SNCF", null, null, "fr"))
        assertEquals("Valence TGV", stations.localize("Valence Bahnhof", 44.9901, 4.9701, "fr"))
        // another word is kept
        assertEquals("Nîmes Pont-du-Gard", stations.localize("Nîmes Pont-du-Gard", null, null, "fr"))
    }

    @Test
    fun `a city with several stations gives the main one when none is near`() {
        assertEquals("Valence Ville", stations.localize("Valence", null, null, "fr"))
        // the coordinates choose the station
        assertEquals("Valence TGV", stations.localize("Valence", 44.9901, 4.9701, "fr"))
        assertEquals("Valencia TGV", stations.localize("Valence", 44.9901, 4.9701, "es"))
    }

    @Test
    fun `a stop far from the stations of its city is not renamed`() {
        // a bus stop of Girona somewhere else
        assertEquals("Girona", stations.localize("Girona", 42.5, 3.0, "fr"))
    }

    @Test
    fun `the other names are kept`() {
        assertEquals("Lyon Part Dieu", stations.localize("Lyon Part Dieu", null, null, "fr"))
        assertEquals("Girona", stations.localize("Girona", 41.9795, 2.8165, "pt"))
    }

    @Test
    fun `the language is the first one supported`() {
        assertEquals("es", listOf("pt", "es-ES", "fr").stationLanguage())
        assertEquals("fr", listOf("FR").stationLanguage())
        assertEquals(null, listOf("pt").stationLanguage())
        assertEquals(null, null.stationLanguage())
    }

    @Test
    fun `the stations of the application name the stops of the AVE feed like the SNCF does`() {
        val real = StationNames.default
        // stops of the Spain-France feed (coordinates of the stops, name cleaned by displayName)
        assertEquals("Nîmes Centre", real.localize("Nimes", 43.83229, 4.365845, "fr"))
        assertEquals("Gérone", real.localize("Girona", 41.979, 2.8165, "fr"))
        assertEquals("Gerona", real.localize("Girona", 41.979, 2.8165, "es"))
        assertEquals("Barcelone Sants", real.localize("Barcelona Sants", 41.3792, 2.1401, "fr"))
        assertEquals("Cologne Hbf", real.localize("Köln Hbf", null, null, "en"))
        assertEquals("Vienne Hbf", real.localize("Wien Hbf", null, null, "fr"))
        // the name of an SNCF stop is kept but for its city
        assertEquals("Marsella St-Charles", real.localize("Marseille St-Charles", null, null, "es"))
    }
}
