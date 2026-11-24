package org.litote.motis.mcp.realtime.sncf

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class SncfTrainsTest {
    @Test
    fun `feedNumber reads the train number of an OCE trip id`() {
        assertEquals("5537", SncfTrains.feedNumber("OCESN5537F3779532:2026-11-20T10:12:00+01:00"))
        assertEquals("849606", SncfTrains.feedNumber("OCESN849606F"))
        assertEquals("17703", SncfTrains.feedNumber("OCESA017703F"))
    }

    @Test
    fun `feedNumber reads the train number of a NeTEx service journey`() {
        assertEquals("6823", SncfTrains.feedNumber("FR:ServiceJourney::SN6823FERRE_20261124:LOC"))
        assertEquals("17703", SncfTrains.feedNumber("SNC:FR:ServiceJourney::SN017703FERRE_20261124:LOC"))
        assertEquals("6823", SncfTrains.feedNumber("2026-11-24_10:12_fr-horaires-sncf_FR:ServiceJourney::SN6823FERRE_x"))
    }

    @Test
    fun `feedNumber is null for a trip id that is not an SNCF train`() {
        assertNull(SncfTrains.feedNumber("FR:ServiceJourney::BUS_42"))
        assertNull(SncfTrains.feedNumber("trip-123"))
        assertNull(SncfTrains.feedNumber("XOCESN5537F"))
    }
}
