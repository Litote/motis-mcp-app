package org.litote.motis.mcp

import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import org.litote.motis.client.client.Client
import org.litote.motis.client.client.ClientConfiguration
import org.litote.motis.client.client.GeocodeClient
import org.litote.motis.client.client.MapClient
import org.litote.motis.client.client.RoutingClient
import org.litote.motis.client.client.TimetableClient
import org.litote.motis.client.model.HealthResponse
import org.litote.motis.client.model.Itinerary
import org.litote.motis.client.model.LocationType
import org.litote.motis.client.model.Match
import org.litote.motis.client.model.Mode
import org.litote.motis.client.model.Place
import org.litote.motis.client.model.Reachable
import kotlin.math.cos
import kotlin.math.log2
import kotlin.time.Instant

/** Error reported by the MOTIS API, or invalid user input: returned to the caller as a tool error. */
class MotisToolException(message: String) : RuntimeException(message)

/** Geographic bounding box. MOTIS expects `min` = south-west corner and `max` = north-east corner. */
data class BoundingBox(val minLat: Double, val minLon: Double, val maxLat: Double, val maxLon: Double) {
    val min: String get() = "$minLat,$minLon"
    val max: String get() = "$maxLat,$maxLon"
    val centerLat: Double get() = (minLat + maxLat) / 2
    val centerLon: Double get() = (minLon + maxLon) / 2

    /** Same center, sides multiplied by [factor]. */
    fun expand(factor: Double): BoundingBox {
        val dLat = (maxLat - minLat) * (factor - 1) / 2
        val dLon = (maxLon - minLon) * (factor - 1) / 2
        return BoundingBox(minLat - dLat, minLon - dLon, maxLat + dLat, maxLon + dLon)
    }

    companion object {
        private const val KM_PER_DEGREE = 111.32

        fun around(lat: Double, lon: Double, radiusKm: Double): BoundingBox {
            val dLat = radiusKm / KM_PER_DEGREE
            val dLon = radiusKm / (KM_PER_DEGREE * cos(Math.toRadians(lat)).coerceAtLeast(0.01))
            return BoundingBox(lat - dLat, lon - dLon, lat + dLat, lon + dLon)
        }

        /** Approximate web map zoom level showing a [radiusKm] radius. */
        fun zoomFor(radiusKm: Double): Double = (14 - log2(radiusKm.coerceAtLeast(0.1))).coerceIn(4.0, 18.0)
    }
}

/**
 * A place resolved from user input.
 *
 * @property id value accepted by MOTIS routing parameters: a stop id or `lat,lon`
 */
data class ResolvedPlace(val id: String, val name: String, val lat: Double, val lon: Double, val isStop: Boolean)

/** Wraps the MOTIS clients: unwraps the sealed responses and resolves free text places. */
class MotisGateway(configuration: ClientConfiguration) {
    private val client = Client(configuration)
    private val geocodeClient = GeocodeClient(configuration)
    private val mapClient = MapClient(configuration)
    private val timetableClient = TimetableClient(configuration)
    private val routingClient = RoutingClient(configuration)

    suspend fun geocode(
        text: String,
        types: List<LocationType>? = null,
        near: String? = null,
        numResults: Int? = null,
        language: List<String>? = null,
    ): List<Match> =
        when (
            val r =
                geocodeClient.geocode(
                    text = text,
                    type = types,
                    place = near,
                    numResults = numResults?.toLong(),
                    language = language,
                )
        ) {
            is GeocodeClient.GeocodeResponseSuccess -> r.body
            is GeocodeClient.GeocodeResponseFailure -> fail(r.body.error)
            is GeocodeClient.GeocodeResponseUnknownFailure -> failStatus(r.statusCode)
        }

    suspend fun reverseGeocode(lat: Double, lon: Double, numResults: Int? = null): List<Match> =
        when (val r = geocodeClient.reverseGeocode(place = "$lat,$lon", numResults = numResults?.toLong())) {
            is GeocodeClient.ReverseGeocodeResponseSuccess -> r.body
            is GeocodeClient.ReverseGeocodeResponseFailure -> fail(r.body.error)
            is GeocodeClient.ReverseGeocodeResponseUnknownFailure -> failStatus(r.statusCode)
        }

    /**
     * Resolves [input]: `lat,lon` coordinates are used as is, other text is geocoded
     * (stops only when [stopsOnly] is true) and the best match is returned.
     */
    suspend fun resolvePlace(input: String, stopsOnly: Boolean = false): ResolvedPlace {
        parseCoordinates(input)?.let { (lat, lon) -> return ResolvedPlace("$lat,$lon", input, lat, lon, isStop = false) }
        val match =
            geocode(input, types = if (stopsOnly) listOf(LocationType.STOP) else null, numResults = 1).firstOrNull()
                ?: throw MotisToolException("No place found for \"$input\"")
        val isStop = match.type == LocationType.STOP
        return ResolvedPlace(
            id = if (isStop) match.id else "${match.lat},${match.lon}",
            name = match.name,
            lat = match.lat,
            lon = match.lon,
            isStop = isStop,
        )
    }

    suspend fun health(): HealthResponse =
        when (val r = client.health()) {
            is Client.HealthResponseSuccess -> r.body
            // unhealthy server (503): the body still describes the state
            is Client.HealthResponseFailure -> r.body
            is Client.HealthResponseUnknownFailure -> failStatus(r.statusCode)
        }

    suspend fun initial(): MapClient.InitialResponseBody =
        when (val r = mapClient.initial()) {
            is MapClient.InitialResponseSuccess -> r.body
            is MapClient.InitialResponseFailure -> fail(r.body.error)
            is MapClient.InitialResponseUnknownFailure -> failStatus(r.statusCode)
        }

    suspend fun stops(bbox: BoundingBox, modes: List<Mode>? = null, language: List<String>? = null): List<Place> =
        when (val r = mapClient.stops(min = bbox.min, max = bbox.max, modes = modes, language = language)) {
            is MapClient.StopsResponseSuccess -> r.body
            is MapClient.StopsResponseFailure -> fail(r.body.error)
            is MapClient.StopsResponseUnknownFailure -> failStatus(r.statusCode)
        }

    suspend fun routes(bbox: BoundingBox, zoom: Double, language: List<String>? = null): MapClient.RoutesResponseBody =
        when (val r = mapClient.routes(zoom = zoom, min = bbox.min, max = bbox.max, language = language)) {
            is MapClient.RoutesResponseSuccess -> r.body
            is MapClient.RoutesResponseFailure -> fail(r.body.error)
            is MapClient.RoutesResponseUnknownFailure -> failStatus(r.statusCode)
        }

    /** Stops and routes of an area, fetched concurrently. */
    suspend fun area(
        bbox: BoundingBox,
        zoom: Double,
        modes: List<Mode>? = null,
        language: List<String>? = null,
    ): Pair<List<Place>, MapClient.RoutesResponseBody> =
        coroutineScope {
            val stops = async { stops(bbox, modes, language) }
            val routes = async { routes(bbox, zoom, language) }
            stops.await() to routes.await()
        }

    suspend fun routeDetails(routeIdx: Long, language: List<String>? = null): MapClient.RouteDetailsResponseBody =
        when (val r = mapClient.routeDetails(routeIdx = routeIdx, language = language)) {
            is MapClient.RouteDetailsResponseSuccess -> r.body
            is MapClient.RouteDetailsResponseFailure -> fail(r.body.error)
            is MapClient.RouteDetailsResponseUnknownFailure -> failStatus(r.statusCode)
        }

    suspend fun stopTimes(
        stopId: String,
        time: Instant? = null,
        arriveBy: Boolean = false,
        n: Int = DEFAULT_STOP_TIMES,
        modes: List<Mode>? = null,
        pageCursor: String? = null,
        language: List<String>? = null,
    ): TimetableClient.StoptimesResponseBody =
        when (
            val r =
                timetableClient.stoptimes(
                    stopId = stopId,
                    time = time,
                    arriveBy = arriveBy,
                    n = n.toLong(),
                    mode = modes,
                    pageCursor = pageCursor,
                    language = language,
                )
        ) {
            is TimetableClient.StoptimesResponseSuccess -> r.body
            is TimetableClient.StoptimesResponseFailure -> fail(r.body.error)
            is TimetableClient.StoptimesResponseUnknownFailure -> failStatus(r.statusCode)
        }

    suspend fun trip(tripId: String, language: List<String>? = null): Itinerary =
        when (val r = timetableClient.trip(tripId = tripId, language = language)) {
            is TimetableClient.TripResponseSuccess -> r.body
            is TimetableClient.TripResponseFailure -> fail(r.body.error)
            is TimetableClient.TripResponseUnknownFailure -> failStatus(r.statusCode)
        }

    suspend fun plan(
        from: String,
        to: String,
        time: Instant? = null,
        arriveBy: Boolean = false,
        transitModes: List<Mode>? = null,
        maxTransfers: Int? = null,
        numItineraries: Int? = null,
        pageCursor: String? = null,
        language: List<String>? = null,
    ): RoutingClient.PlanResponseBody =
        when (
            val r =
                routingClient.plan(
                    fromPlace = from,
                    toPlace = to,
                    time = time,
                    arriveBy = arriveBy,
                    transitModes = transitModes,
                    maxTransfers = maxTransfers?.toLong(),
                    numItineraries = numItineraries?.toLong(),
                    pageCursor = pageCursor,
                    language = language,
                )
        ) {
            is RoutingClient.PlanResponseSuccess -> r.body
            is RoutingClient.PlanResponseFailure -> fail(r.body.error)
            is RoutingClient.PlanResponseUnknownFailure -> failStatus(r.statusCode)
        }

    suspend fun oneToAll(
        one: String,
        maxTravelTimeMinutes: Int,
        time: Instant? = null,
        arriveBy: Boolean = false,
        maxTransfers: Int? = null,
        transitModes: List<Mode>? = null,
    ): Reachable =
        when (
            val r =
                routingClient.oneToAll(
                    one = one,
                    maxTravelTime = maxTravelTimeMinutes.toLong(),
                    time = time,
                    arriveBy = arriveBy,
                    maxTransfers = maxTransfers?.toLong(),
                    transitModes = transitModes,
                )
        ) {
            is RoutingClient.OneToAllResponseSuccess -> r.body
            is RoutingClient.OneToAllResponseFailure -> fail(r.body.error)
            is RoutingClient.OneToAllResponseUnknownFailure -> failStatus(r.statusCode)
        }

    suspend fun rentals(
        bbox: BoundingBox? = null,
        providers: List<String>? = null,
        withStations: Boolean = true,
        withVehicles: Boolean = true,
    ): MapClient.RentalsResponseBody =
        when (
            val r =
                mapClient.rentals(
                    min = bbox?.min,
                    max = bbox?.max,
                    providers = providers,
                    withProviders = true,
                    withStations = withStations,
                    withVehicles = withVehicles,
                    withZones = false,
                )
        ) {
            is MapClient.RentalsResponseSuccess -> r.body
            is MapClient.RentalsResponseFailure -> fail(r.body.error)
            is MapClient.RentalsResponseUnknownFailure -> failStatus(r.statusCode)
        }

    companion object {
        const val DEFAULT_STOP_TIMES = 20

        private val COORDINATES = Regex("""^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$""")

        fun parseCoordinates(input: String): Pair<Double, Double>? =
            COORDINATES.matchEntire(input)?.let { m ->
                val lat = m.groupValues[1].toDouble()
                val lon = m.groupValues[2].toDouble()
                (lat to lon).takeIf { lat in -90.0..90.0 && lon in -180.0..180.0 }
            }

        private fun fail(message: String): Nothing = throw MotisToolException("MOTIS error: $message")

        private fun failStatus(statusCode: Int): Nothing =
            throw MotisToolException("MOTIS API call failed (HTTP status $statusCode)")
    }
}
