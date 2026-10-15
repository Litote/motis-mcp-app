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
import org.litote.motis.client.model.PedestrianProfile
import org.litote.motis.client.model.Place
import org.litote.motis.client.model.Reachable
import org.litote.motis.mcp.dto.distanceKm
import org.litote.motis.mcp.dto.toDto
import kotlin.math.abs
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
 * @property area city or region of a geocoded place, null when unknown
 */
data class ResolvedPlace(
    val id: String,
    val name: String,
    val lat: Double,
    val lon: Double,
    val isStop: Boolean,
    val area: String? = null,
) {
    /** Name with its area when the name does not tell it, e.g. `Saint Michel (Bordeaux)`. */
    val label: String get() = name + (area?.takeUnless { name.contains(it, ignoreCase = true) }?.let { " ($it)" } ?: "")
}

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
     * (stops only when [stopsOnly] is true, favoring places near the `lat,lon` [near] position) and the best match
     * is returned. Fails listing the candidates when another place, far from the best match, matches almost as well.
     */
    suspend fun resolvePlace(
        input: String,
        stopsOnly: Boolean = false,
        near: String? = null,
        language: List<String>? = null,
    ): ResolvedPlace {
        parseCoordinates(input)?.let { (lat, lon) -> return ResolvedPlace("$lat,$lon", input, lat, lon, isStop = false) }
        val matches =
            geocode(
                input,
                types = if (stopsOnly) listOf(LocationType.STOP) else null,
                near = near,
                numResults = RESOLUTION_CANDIDATES,
                language = language,
            )
        // not a name: a stop id maybe (the geocoder does not search ids)
        val match = matches.firstOrNull() ?: return resolveStopId(input) ?: throw MotisToolException("No place found for \"$input\"")
        val rivals = matches.drop(1).filter { it.isRivalOf(match) }
        if (rivals.isNotEmpty()) {
            throw MotisToolException(
                (listOf(match) + rivals).joinToString(
                    "\n",
                    "\"$input\" is ambiguous, candidates:\n",
                    "\nRetry with one of these stop ids or coordinates, or a more precise name (e.g. with the city).",
                ) { m ->
                    val stopId = if (m.type == LocationType.STOP) " id=${m.id}" else ""
                    "- ${m.name}${m.toDto().area?.let { " — $it" } ?: ""}$stopId (${m.lat},${m.lon})"
                },
            )
        }
        val isStop = match.type == LocationType.STOP
        return ResolvedPlace(
            id = if (isStop) match.id else "${match.lat},${match.lon}",
            name = match.name,
            lat = match.lat,
            lon = match.lon,
            isStop = isStop,
            area = match.toDto().area,
        )
    }

    /** The stop of id [stopId], null when MOTIS does not know it. */
    private suspend fun resolveStopId(stopId: String): ResolvedPlace? =
        when (val r = timetableClient.stoptimes(stopId = stopId, n = 1)) {
            is TimetableClient.StoptimesResponseSuccess ->
                r.body.place.let { ResolvedPlace(stopId, it.name, it.lat, it.lon, isStop = true) }
            else -> null
        }

    suspend fun health(): HealthResponse =
        when (val r = client.health()) {
            is Client.HealthResponseSuccess -> r.body
            // unhealthy server: the body still describes the state
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
                    // next (previous) stops of each trip, shown on the departures (arrivals) board
                    fetchStops = true,
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

    suspend fun plan(query: PlanQuery): RoutingClient.PlanResponseBody =
        when (
            val r =
                routingClient.plan(
                    fromPlace = query.from,
                    toPlace = query.to,
                    time = query.time,
                    arriveBy = query.arriveBy,
                    transitModes = query.transitModes,
                    maxTransfers = query.maxTransfers?.toLong(),
                    pedestrianSpeed = query.walkingSpeed.metersPerSecond,
                    pedestrianProfile = if (query.wheelchair) PedestrianProfile.WHEELCHAIR else null,
                    additionalTransferTime = query.transferMargin.additionalMinutes,
                    // pre/post transit modes only apply to coordinates, not to stops (see PlanQuery.bike)
                    preTransitModes = query.bike.preTransitModes,
                    postTransitModes = query.bike.postTransitModes,
                    directModes = query.bike.directModes,
                    requireBikeTransport = query.bike == BikeOption.ON_BOARD,
                    // walk to the first stop and from the last stop (MOTIS default: 15 min)
                    maxPreTransitTime = query.maxWalkMinutes * 60L,
                    maxPostTransitTime = query.maxWalkMinutes * 60L,
                    // transfers of the timetable, not routed on the streets: the server caps the routed ones (about
                    // 15 min), which drops walks between nearby stations (e.g. Paris Gare de Lyon -> Austerlitz)
                    useRoutedTransfers = false,
                    // not sent: the 25 m default of the client leaves stops far from a street (e.g. inside a station)
                    // without walking legs, the server default does not
                    maxMatchingDistance = null,
                    numItineraries = query.numItineraries?.toLong(),
                    pageCursor = query.pageCursor,
                    language = query.language,
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

        /** Walk to the first stop and from the last stop of a journey, in minutes. */
        const val DEFAULT_MAX_WALK_MINUTES = 25

        /** Geocoding matches compared to detect an ambiguous place. */
        private const val RESOLUTION_CANDIDATES = 5

        /**
         * Score difference under which two matches are equally likely. MOTIS scores are negative, the best (lowest)
         * first: calibrated on Transitous, where clear matches lead by more than 1 and homonyms by less than 0.3.
         */
        private const val AMBIGUOUS_SCORE_GAP = 0.75

        /** Distance beyond which two matches are different places (closer: entrances or platforms of one place). */
        private const val DISTINCT_PLACES_KM = 10.0

        private fun Match.isRivalOf(best: Match): Boolean =
            abs(score - best.score) < AMBIGUOUS_SCORE_GAP && distanceKm(lat, lon, best.lat, best.lon) > DISTINCT_PLACES_KM

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

/** Walking speed of the journeys: [metersPerSecond] null for the MOTIS default (about 1.2 m/s). */
enum class WalkingSpeed(val metersPerSecond: Double?) {
    SLOW(0.8),
    NORMAL(null),
    FAST(1.6),
}

/** Time reserved for each transfer, in addition to the minimum transfer time of the timetable. */
enum class TransferMargin(val additionalMinutes: Long) {
    NORMAL(0),
    COMFORTABLE(5),
}

/** Bike of the traveller: ridden to the first stop ([TO_STATION]), or carried on board and ridden at both ends. */
enum class BikeOption(val preTransitModes: List<Mode>?, val postTransitModes: List<Mode>?, val directModes: List<Mode>?) {
    NONE(null, null, null),
    TO_STATION(listOf(Mode.BIKE), listOf(Mode.WALK), listOf(Mode.WALK, Mode.BIKE)),
    ON_BOARD(listOf(Mode.BIKE), listOf(Mode.BIKE), listOf(Mode.BIKE)),
}

/**
 * Journey query of [MotisGateway.plan]: [from] and [to] are stop ids or `lat,lon` coordinates. With a [bike], the ends
 * ridden by bike must be coordinates: MOTIS only applies the pre/post transit modes to coordinates.
 */
data class PlanQuery(
    val from: String,
    val to: String,
    val time: Instant? = null,
    val arriveBy: Boolean = false,
    val transitModes: List<Mode>? = null,
    val maxTransfers: Int? = null,
    val maxWalkMinutes: Int = MotisGateway.DEFAULT_MAX_WALK_MINUTES,
    val walkingSpeed: WalkingSpeed = WalkingSpeed.NORMAL,
    val wheelchair: Boolean = false,
    val transferMargin: TransferMargin = TransferMargin.NORMAL,
    val bike: BikeOption = BikeOption.NONE,
    val numItineraries: Int? = null,
    val pageCursor: String? = null,
    val language: List<String>? = null,
)
