package org.litote.motis.mcp

import io.github.oshai.kotlinlogging.KotlinLogging
import io.ktor.client.HttpClient
import io.ktor.client.engine.HttpClientEngineFactory
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.logging.LogLevel
import org.litote.motis.client.client.ClientConfiguration
import org.litote.motis.client.motisClientConfiguration
import org.litote.motis.mcp.cities.CityJourneys
import org.litote.motis.mcp.cities.CityStationsStore
import org.litote.motis.mcp.cities.DynamoDbCityStationsStore
import org.litote.motis.mcp.cities.InMemoryCityStationsStore
import org.litote.motis.mcp.realtime.RealtimeOverlay
import org.litote.motis.mcp.realtime.SncfRealtimeOverlay

const val APP_NAME = "motis-mcp-app"
const val APP_URL = "https://github.com/Litote/motis-mcp-app"

private val logger = KotlinLogging.logger {}

/**
 * Server configuration, read from the environment.
 *
 * Transitous requires a `User-Agent` containing a way of contact: [contact] is mandatory with Transitous, optional with
 * another MOTIS server (the website of the application is sent instead).
 *
 * [viewDomains] are the dedicated origins of the views requested to each host on its endpoint `/mcp/<host>`
 * (`_meta.ui.domain`, e.g. to allowlist at the tile provider): their format depends on the host (see [McpHost]).
 *
 * [allowedHosts] are the host names accepted by the HTTP server in addition to localhost (DNS rebinding protection),
 * null for localhost only.
 *
 * [sncfRealtime] adds the real time of the SNCF to its trains without real time in MOTIS, see [SncfRealtimeOverlay].
 *
 * [repairShapes] replaces the detours of the shapes of the transit legs by straight lines between their stops, see
 * [org.litote.motis.mcp.dto.LegGeometry].
 *
 * [cityStationsTable] is the DynamoDB table of the stations of the journeys between cities (in [awsRegion]), null to
 * keep them in memory, see [CityJourneys]. [dynamoDbEndpoint] replaces the endpoint of the region, e.g. DynamoDB Local.
 */
data class MotisMcpConfig(
    val contact: String?,
    val baseUrl: String = DEFAULT_BASE_URL,
    val logLevel: LogLevel = LogLevel.NONE,
    val tiles: MapTiles = MapTiles(),
    val viewDomains: Map<McpHost, String> = emptyMap(),
    val allowedHosts: List<String>? = null,
    val sncfRealtime: Boolean = true,
    val repairShapes: Boolean = true,
    val cityStationsTable: String? = null,
    val awsRegion: String? = null,
    val dynamoDbEndpoint: String? = null,
) {
    init {
        require(contact != null || !isTransitous(baseUrl)) {
            "MOTIS_APP_CONTACT is required with Transitous (e-mail address or website URL, sent in the User-Agent)"
        }
    }

    /** The clients catch their exceptions (returned as a 500 status): they are logged here rather than printed. */
    fun clientConfiguration(engine: HttpClientEngineFactory<*> = OkHttp): ClientConfiguration {
        val base =
            motisClientConfiguration(
                applicationName = APP_NAME,
                applicationVersion = APP_VERSION,
                contact = contact ?: APP_URL,
                baseUrl = baseUrl,
                logLevel = logLevel,
                engine = engine,
            )
        return ClientConfiguration(
            baseUrl = base.baseUrl,
            logLevel = base.logLevel,
            userAgent = base.userAgent,
            engine = engine,
            json = base.json,
            client = base.client,
            exceptionLogger = { logger.warn(this) { "MOTIS API call failed: $this" } },
        )
    }

    /** Store of the stations of the journeys between cities: created once, shared by the server instances. */
    fun cityStationsStore(): CityStationsStore =
        cityStationsTable?.let { table ->
            DynamoDbCityStationsStore.create(
                table,
                requireNotNull(awsRegion) { "AWS_REGION is required with MOTIS_CITY_STATIONS_TABLE" },
                dynamoDbEndpoint,
            )
        } ?: InMemoryCityStationsStore()

    /** Real-time overlays of the stop times (see [MotisGateway]), sending the [userAgent] of the MOTIS clients. */
    fun realtimeOverlays(userAgent: String?, engine: HttpClientEngineFactory<*> = OkHttp): List<RealtimeOverlay> =
        if (sncfRealtime) listOf(SncfRealtimeOverlay(HttpClient(engine), userAgent)) else emptyList()

    companion object {
        const val DEFAULT_BASE_URL = "https://api.transitous.org/"

        /** True for the Transitous API (usage policy: a way of contact in the `User-Agent`). */
        fun isTransitous(baseUrl: String): Boolean {
            val host = Regex("""^https?://([^/:]+)""").find(baseUrl)?.groupValues?.get(1)?.lowercase() ?: return false
            return host == "transitous.org" || host.endsWith(".transitous.org")
        }

        fun fromEnv(env: Map<String, String> = System.getenv()): MotisMcpConfig =
            MotisMcpConfig(
                contact = env["MOTIS_APP_CONTACT"]?.takeIf { it.isNotBlank() },
                baseUrl = env["MOTIS_BASE_URL"]?.takeIf { it.isNotBlank() } ?: DEFAULT_BASE_URL,
                logLevel = env["MOTIS_LOG_LEVEL"]?.takeIf { it.isNotBlank() }?.let(::parseLogLevel) ?: LogLevel.NONE,
                tiles =
                    MapTiles(
                        url = env["MOTIS_TILE_URL"]?.takeIf { it.isNotBlank() } ?: MapTiles.OSM_URL,
                        attribution = env["MOTIS_TILE_ATTRIBUTION"]?.takeIf { it.isNotBlank() } ?: MapTiles.OSM_ATTRIBUTION,
                        vectorUrl = env["MOTIS_VECTOR_TILE_URL"]?.takeIf { it.isNotBlank() },
                        vectorAttribution =
                            env["MOTIS_VECTOR_TILE_ATTRIBUTION"]?.takeIf { it.isNotBlank() } ?: MapTiles.PROTOMAPS_ATTRIBUTION,
                        railOverlays = env["MOTIS_RAIL_OVERLAY"]?.let(::parseRailOverlays).orEmpty(),
                    ),
                viewDomains =
                    McpHost.entries
                        .mapNotNull { host -> env[host.envName]?.takeIf { it.isNotBlank() }?.let { host to it } }
                        .toMap(),
                allowedHosts =
                    env["MCP_ALLOWED_HOSTS"]
                        ?.split(',')
                        ?.map { it.trim() }
                        ?.filter { it.isNotEmpty() }
                        ?.ifEmpty { null },
                sncfRealtime = env.boolean("MOTIS_SNCF_REALTIME") ?: true,
                repairShapes = env.boolean("MOTIS_REPAIR_SHAPES") ?: true,
                cityStationsTable = env["MOTIS_CITY_STATIONS_TABLE"]?.takeIf { it.isNotBlank() },
                awsRegion = (env["AWS_REGION"] ?: env["AWS_DEFAULT_REGION"])?.takeIf { it.isNotBlank() },
                dynamoDbEndpoint = env["AWS_ENDPOINT_URL_DYNAMODB"]?.takeIf { it.isNotBlank() },
            )

        private fun Map<String, String>.boolean(name: String): Boolean? =
            this[name]?.takeIf { it.isNotBlank() }?.let { value ->
                requireNotNull(value.trim().lowercase().toBooleanStrictOrNull()) { "$name must be true or false: \"$value\"" }
            }

        private fun parseRailOverlays(value: String): List<RailOverlay> =
            value
                .split(',')
                .map { it.trim() }
                .filter { it.isNotEmpty() }
                .map { id ->
                    requireNotNull(RailOverlay.entries.firstOrNull { it.id == id.lowercase() }) {
                        "MOTIS_RAIL_OVERLAY must be a comma-separated list of ${RailOverlay.entries.joinToString { it.id }}: \"$value\""
                    }
                }.distinct()

        private fun parseLogLevel(value: String): LogLevel =
            requireNotNull(LogLevel.entries.firstOrNull { it.name.equals(value.trim(), ignoreCase = true) }) {
                "MOTIS_LOG_LEVEL must be one of ${LogLevel.entries.joinToString()}: \"$value\""
            }
    }
}

/**
 * Tiles of the maps of the views, and the [railOverlays] drawn over them.
 *
 * The raster tiles ([url], Leaflet URL template, e.g. `https://{s}.tile.example.org/{z}/{x}/{y}.png`) are replaced by
 * the vector tiles of [vectorUrl] when set: Protomaps basemap schema, `…/{z}/{x}/{y}.mvt` (e.g. the Protomaps hosted
 * API, `https://api.protomaps.com/tiles/v4/{z}/{x}/{y}.mvt?key=…`, or a PMTiles deployment), drawn in the theme of the
 * host.
 * The default OpenStreetMap tiles are subject to the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/).
 */
data class MapTiles(
    val url: String = OSM_URL,
    val attribution: String = OSM_ATTRIBUTION,
    val railOverlays: List<RailOverlay> = emptyList(),
    val vectorUrl: String? = null,
    val vectorAttribution: String = PROTOMAPS_ATTRIBUTION,
) {
    /** Origins of the tiles used and of the overlays, for the CSP of the views (`{s}` subdomains become a wildcard). */
    val origins: List<String>
        get() = (listOf(vectorUrl ?: url) + railOverlays.map { it.url }).map(::origin).distinct()

    companion object {
        const val OSM_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        const val OSM_ATTRIBUTION = "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors"
        const val PROTOMAPS_ATTRIBUTION =
            "<a href=\"https://protomaps.com\">Protomaps</a> &copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a>"

        private fun origin(url: String): String {
            val match = Regex("""^(https?://[^/?]+)""").find(url) ?: error("Invalid tile URL: $url")
            return match.value.replace(Regex("""\{[a-z]}"""), "*")
        }
    }
}

/** Area covered by a [RailOverlay]: the views use the French one in France, the world one elsewhere. */
enum class OverlayArea(val id: String) { FRANCE("france"), WORLD("world") }

/**
 * Transparent raster tiles of the railways, drawn over the map (`MOTIS_RAIL_OVERLAY`), from [minZoom] to
 * [maxNativeZoom] (zoomed in beyond).
 */
enum class RailOverlay(
    val id: String,
    val url: String,
    val attribution: String,
    val area: OverlayArea,
    val minZoom: Int,
    val maxNativeZoom: Int,
) {
    /** Railways of the BD TOPO, open data of the IGN (Géoplateforme, no key): France only, zoom 6 to 18. */
    IGN(
        "ign",
        "https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&STYLE=normal&TILEMATRIXSET=PM" +
            "&FORMAT=image/png&LAYER=TRANSPORTNETWORKS.RAILWAYS&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}",
        "&copy; <a href=\"https://www.ign.fr/\">IGN</a>",
        OverlayArea.FRANCE,
        minZoom = 6,
        maxNativeZoom = 18,
    ),

    /**
     * OpenRailwayMap (volunteer servers, [usage policy](https://wiki.openstreetmap.org/wiki/OpenRailwayMap/API): light
     * use by public free applications): the world.
     */
    OPENRAILWAYMAP(
        "openrailwaymap",
        "https://tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png",
        "Data &copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors, " +
            "Style: <a href=\"https://creativecommons.org/licenses/by-sa/2.0/\">CC-BY-SA 2.0</a> " +
            "<a href=\"https://www.openrailwaymap.org/\">OpenRailwayMap</a>",
        OverlayArea.WORLD,
        minZoom = 0,
        maxNativeZoom = 19,
    ),
}
