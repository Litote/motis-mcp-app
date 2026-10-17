package org.litote.motis.mcp

import io.ktor.client.plugins.logging.LogLevel
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
    fun `view domains are optional, per host`() {
        val contact = "MOTIS_APP_CONTACT" to "you@example.org"
        assertEquals(emptyMap(), MotisMcpConfig.fromEnv(mapOf(contact)).viewDomains)
        assertEquals(
            mapOf(McpHost.CHATGPT to "https://motis.example.org"),
            MotisMcpConfig.fromEnv(
                mapOf(contact, "MOTIS_VIEW_DOMAIN_CHATGPT" to "https://motis.example.org", "MOTIS_VIEW_DOMAIN_CLAUDE" to " "),
            ).viewDomains,
        )
    }

    @Test
    fun `log level is case-insensitive and validated`() {
        val contact = "MOTIS_APP_CONTACT" to "you@example.org"
        assertEquals(LogLevel.NONE, MotisMcpConfig.fromEnv(mapOf(contact, "MOTIS_LOG_LEVEL" to " ")).logLevel)
        assertEquals(LogLevel.HEADERS, MotisMcpConfig.fromEnv(mapOf(contact, "MOTIS_LOG_LEVEL" to "headers")).logLevel)
        val error = assertFailsWith<IllegalArgumentException> { MotisMcpConfig.fromEnv(mapOf(contact, "MOTIS_LOG_LEVEL" to "verbose")) }
        assertTrue(error.message!!.startsWith("MOTIS_LOG_LEVEL must be one of "), error.message)
    }

    @Test
    fun `allowed hosts are a comma-separated list`() {
        val contact = "MOTIS_APP_CONTACT" to "you@example.org"
        assertNull(MotisMcpConfig.fromEnv(mapOf(contact)).allowedHosts)
        assertNull(MotisMcpConfig.fromEnv(mapOf(contact, "MCP_ALLOWED_HOSTS" to " , ")).allowedHosts)
        assertEquals(
            listOf("mcp.example.org", "motis.example.org"),
            MotisMcpConfig.fromEnv(mapOf(contact, "MCP_ALLOWED_HOSTS" to "mcp.example.org, motis.example.org,")).allowedHosts,
        )
    }

    @Test
    fun `Claude view domain is derived from the endpoint URL`() {
        // first 32 hexadecimal characters of sha256("https://example.com/mcp"), as computeAppDomainForClaude of ext-apps
        assertEquals("c3d80a4ed901ee05b21755a88273b4a4.claudemcpcontent.com", claudeViewDomain("https://example.com/mcp"))
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
