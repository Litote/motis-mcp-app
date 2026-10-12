package org.litote.motis.mcp

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class MotisMcpConfigTest {
    @Test
    fun `contact is required with Transitous`() {
        val error = assertFailsWith<IllegalArgumentException> { MotisMcpConfig.fromEnv(emptyMap()) }
        assertTrue(error.message!!.contains("MOTIS_APP_CONTACT"))
        assertFailsWith<IllegalArgumentException> {
            MotisMcpConfig.fromEnv(mapOf("MOTIS_APP_CONTACT" to " ", "MOTIS_BASE_URL" to "https://api.transitous.org/"))
        }
    }

    @Test
    fun `contact is optional with another MOTIS server`() {
        val config = MotisMcpConfig.fromEnv(mapOf("MOTIS_BASE_URL" to "http://motis:8080/"))
        assertNull(config.contact)
        assertEquals("http://motis:8080/", config.baseUrl)
        val userAgent = config.clientConfiguration().userAgent!!
        assertTrue(userAgent.startsWith("$APP_NAME/$APP_VERSION (+$APP_URL) "), userAgent)
    }

    @Test
    fun `contact is sent in the User-Agent`() {
        val config = MotisMcpConfig.fromEnv(mapOf("MOTIS_APP_CONTACT" to "you@example.org"))
        assertEquals(MotisMcpConfig.DEFAULT_BASE_URL, config.baseUrl)
        assertTrue(config.clientConfiguration().userAgent!!.contains("(+you@example.org)"))
    }

    @Test
    fun `Transitous hosts are detected`() {
        assertTrue(MotisMcpConfig.isTransitous("https://api.transitous.org/"))
        assertTrue(MotisMcpConfig.isTransitous("https://API.Transitous.org:443"))
        assertTrue(MotisMcpConfig.isTransitous("https://transitous.org"))
        assertFalse(MotisMcpConfig.isTransitous("http://motis:8080/"))
        assertFalse(MotisMcpConfig.isTransitous("https://nottransitous.org/"))
        assertFalse(MotisMcpConfig.isTransitous("https://example.org/?transitous.org"))
    }
}
