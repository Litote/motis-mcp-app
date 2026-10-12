package org.litote.motis.mcp

import io.ktor.client.engine.HttpClientEngineFactory
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.logging.LogLevel
import org.litote.motis.client.client.ClientConfiguration
import org.litote.motis.client.motisClientConfiguration

const val APP_NAME = "motis-mcp-app"

/**
 * Server configuration, read from the environment.
 *
 * Transitous requires a `User-Agent` containing a way of contact: [contact] is mandatory.
 */
data class MotisMcpConfig(
    val contact: String,
    val baseUrl: String = DEFAULT_BASE_URL,
    val logLevel: LogLevel = LogLevel.NONE,
    val tiles: MapTiles = MapTiles(),
) {
    fun clientConfiguration(engine: HttpClientEngineFactory<*> = OkHttp): ClientConfiguration =
        motisClientConfiguration(
            applicationName = APP_NAME,
            applicationVersion = APP_VERSION,
            contact = contact,
            baseUrl = baseUrl,
            logLevel = logLevel,
            engine = engine,
        )

    companion object {
        const val DEFAULT_BASE_URL = "https://api.transitous.org/"

        fun fromEnv(env: Map<String, String> = System.getenv()): MotisMcpConfig =
            MotisMcpConfig(
                contact =
                    env["MOTIS_APP_CONTACT"]?.takeIf { it.isNotBlank() }
                        ?: error("MOTIS_APP_CONTACT is required (e-mail address or website URL, sent in the User-Agent)"),
                baseUrl = env["MOTIS_BASE_URL"]?.takeIf { it.isNotBlank() } ?: DEFAULT_BASE_URL,
                logLevel = env["MOTIS_LOG_LEVEL"]?.let { LogLevel.valueOf(it.uppercase()) } ?: LogLevel.NONE,
                tiles =
                    MapTiles(
                        url = env["MOTIS_TILE_URL"]?.takeIf { it.isNotBlank() } ?: MapTiles.OSM_URL,
                        attribution = env["MOTIS_TILE_ATTRIBUTION"]?.takeIf { it.isNotBlank() } ?: MapTiles.OSM_ATTRIBUTION,
                    ),
            )
    }
}

/**
 * Raster tiles of the maps of the views (Leaflet URL template, e.g. `https://{s}.tile.example.org/{z}/{x}/{y}.png`).
 * The default OpenStreetMap tiles are subject to the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/).
 */
data class MapTiles(val url: String = OSM_URL, val attribution: String = OSM_ATTRIBUTION) {
    /** Origin of the tiles, for the CSP of the views (`{s}` subdomains become a wildcard). */
    val origin: String
        get() {
            val match = Regex("""^(https?://[^/]+)""").find(url) ?: error("Invalid tile URL: $url")
            return match.value.replace(Regex("""\{[a-z]}"""), "*")
        }

    companion object {
        const val OSM_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        const val OSM_ATTRIBUTION = "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors"
    }
}
