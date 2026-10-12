package org.litote.motis.mcp.dto

import org.litote.motis.client.client.MapClient
import org.litote.motis.client.client.RoutingClient
import org.litote.motis.client.client.TimetableClient
import org.litote.motis.client.model.EncodedPolyline
import org.litote.motis.client.model.Itinerary
import org.litote.motis.client.model.Leg
import org.litote.motis.client.model.Match
import org.litote.motis.client.model.Mode
import org.litote.motis.client.model.Place
import org.litote.motis.client.model.Reachable
import org.litote.motis.client.model.RouteInfo
import org.litote.motis.client.model.RoutePolyline
import org.litote.motis.client.model.StopTime
import org.litote.motis.mcp.BoundingBox

/** Maximum number of stops sent to the views: the most important ones are kept. */
const val MAX_STOPS = 400

/** Maximum number of route polylines sent to the views, and their maximum total size. */
const val MAX_POLYLINES = 1000
const val MAX_POLYLINE_CHARS = 400_000

/** Maximum number of (grouped) routes sent to the views. */
const val MAX_ROUTES = 300

/** Maximum number of reachable places sent to the views (closest first). */
const val MAX_REACHABLE = 3000

/** Maximum number of rental stations and vehicles sent to the views (closest to the center of the area first). */
const val MAX_POINTS = 1000

/**
 * A rental "station" with more vehicles than this is an area-wide virtual station (e.g. a free-floating operator
 * reporting all its vehicles of a city in a single station located at one point), not a place to pick a vehicle: the
 * largest docking stations have about a hundred docks.
 */
const val AREA_STATION_MIN_VEHICLES = 200

fun BoundingBox.toDto(): Bbox = Bbox(minLat, minLon, maxLat, maxLon)

/** GTFS colors are hexadecimal without `#`. */
fun color(value: String?): String? =
    value?.takeIf { it.isNotBlank() }?.let { if (it.startsWith("#")) it else "#$it" }

fun Mode.label(): String = serialName()

fun EncodedPolyline.toDto(): Polyline = Polyline(points, precision.toInt())

fun Place.toDto(): PlaceDto =
    PlaceDto(
        name = name,
        lat = lat,
        lon = lon,
        stopId = stopId,
        modes = modes?.map { it.label() },
        track = track,
        arrival = arrival?.toString(),
        departure = departure?.toString(),
        scheduledArrival = scheduledArrival?.toString(),
        scheduledDeparture = scheduledDeparture?.toString(),
        cancelled = cancelled?.takeIf { it },
        tz = tz,
    )

fun Match.toDto(): PlaceMatchDto =
    PlaceMatchDto(
        id = id,
        name = name,
        type = type.serialName(),
        lat = lat,
        lon = lon,
        area = areas.filter { it.default == true || it.matched }.map { it.name }.distinct().joinToString(", ").ifBlank { null },
        modes = modes?.map { it.label() }?.ifEmpty { null },
    )

/** Display order of the modes: trains first, then urban transit. */
private val MODE_ORDER =
    listOf(
        "HIGHSPEED_RAIL", "LONG_DISTANCE", "NIGHT_RAIL", "REGIONAL_FAST_RAIL", "REGIONAL_RAIL", "RAIL", "SUBURBAN",
        "SUBWAY", "METRO", "TRAM", "BUS", "COACH", "FERRY", "FUNICULAR", "AERIAL_LIFT", "CABLE_CAR",
    )

private fun modeRank(mode: String): Int = MODE_ORDER.indexOf(mode).let { if (it < 0) MODE_ORDER.size else it }

private fun RouteInfo.names(): List<String> =
    transitRoutes.map { it.shortName.ifBlank { it.longName } }.filter { it.isNotBlank() }.distinct()

/**
 * Routes grouped by mode, names and color: MOTIS returns one route per stop sequence,
 * hence many variants of the same line.
 */
private fun groupRoutes(routes: List<RouteInfo>): Pair<List<RouteDto>, Map<Long, Long>> {
    val groups = routes.groupBy { Triple(it.mode, it.names(), it.transitRoutes.firstNotNullOfOrNull { t -> t.color }) }
    val representative = mutableMapOf<Long, Long>()
    val dtos =
        groups.values.map { variants ->
            val main = variants.maxBy { it.numStops }
            variants.forEach { representative[it.routeIdx] = main.routeIdx }
            RouteDto(
                routeIdx = main.routeIdx,
                mode = main.mode.label(),
                names = main.names(),
                color = color(main.transitRoutes.firstNotNullOfOrNull { it.color }),
                textColor = color(main.transitRoutes.firstNotNullOfOrNull { it.textColor }),
                numStops = main.numStops,
                variants = variants.size,
            )
        }.sortedWith(compareBy<RouteDto>({ it.names.isEmpty() }, { modeRank(it.mode) }, { it.names.joinToString() }))
    return dtos to representative
}

/**
 * Polylines of the routes, clipped to [clip] when given (the shapes of long distance routes are huge),
 * without duplicates, within a size budget.
 */
private fun polylines(polylines: List<RoutePolyline>, representative: Map<Long, Long>, clip: BoundingBox?): List<RoutePolylineDto> {
    var budget = MAX_POLYLINE_CHARS
    return polylines
        .asSequence()
        .flatMap { p ->
            val precision = p.polyline.precision.toInt()
            val parts =
                if (clip == null) {
                    listOf(p.polyline.points)
                } else {
                    PolylineCodec.clip(PolylineCodec.decode(p.polyline.points, precision), clip)
                        .map { PolylineCodec.encode(it, precision) }
                }
            val routes = p.routeIndexes.map { representative[it] ?: it }.distinct()
            parts.map { RoutePolylineDto(Polyline(it, precision), color(p.colors.firstOrNull()), routes) }
        }.distinctBy { it.polyline.points }
        .takeWhile { budget > 0 }
        .onEach { budget -= it.polyline.points.length }
        .take(MAX_POLYLINES)
        .toList()
}

/** Display of an area: [clip] clips the route polylines (null: not clipped). */
private class AreaFrame(val kind: String, val title: String, val bbox: BoundingBox, val zoom: Double, val clip: BoundingBox?)

private fun areaResult(
    frame: AreaFrame,
    stops: List<Place>,
    routes: List<RouteInfo>,
    polylines: List<RoutePolyline>,
    zoomFiltered: Boolean,
): AreaResult {
    val (routeDtos, representative) = groupRoutes(routes)
    return AreaResult(
        kind = frame.kind,
        title = frame.title,
        bbox = frame.bbox.toDto(),
        zoom = frame.zoom,
        stops = stops.sortedByDescending { it.importance ?: 0.0 }.take(MAX_STOPS).map { it.toDto() },
        routes = routeDtos.take(MAX_ROUTES),
        polylines = polylines(polylines, representative, frame.clip),
        totalStops = stops.size,
        totalRoutes = routeDtos.size,
        zoomFiltered = zoomFiltered,
    )
}

fun MapClient.RoutesResponseBody.toAreaResult(title: String, bbox: BoundingBox, zoom: Double, stops: List<Place>): AreaResult =
    areaResult(AreaFrame("area", title, bbox, zoom, clip = bbox.expand(1.3)), stops, routes, polylines, zoomFiltered)

fun MapClient.RouteDetailsResponseBody.toAreaResult(title: String): AreaResult {
    val lats = stops.map { it.lat }
    val lons = stops.map { it.lon }
    val bbox =
        if (stops.isEmpty()) {
            BoundingBox(0.0, 0.0, 0.0, 0.0)
        } else {
            BoundingBox(lats.min(), lons.min(), lats.max(), lons.max())
        }
    return areaResult(AreaFrame("routeDetails", title, bbox, 0.0, clip = null), stops, routes, polylines, zoomFiltered)
}

fun StopTime.toDto(arriveBy: Boolean): StopTimeDto =
    StopTimeDto(
        time = (if (arriveBy) place.arrival else place.departure)?.toString(),
        scheduledTime = (if (arriveBy) place.scheduledArrival else place.scheduledDeparture)?.toString(),
        realTime = realTime,
        cancelled = cancelled || tripCancelled,
        mode = mode.label(),
        line = displayName.ifBlank { routeShortName.ifBlank { routeLongName } },
        headsign = headsign.ifBlank { tripTo.name },
        routeColor = color(routeColor),
        routeTextColor = color(routeTextColor),
        track = place.track ?: place.scheduledTrack,
        agency = agencyName,
        tripId = tripId,
    )

fun TimetableClient.StoptimesResponseBody.toDto(arriveBy: Boolean): DeparturesResult =
    DeparturesResult(
        stop = place.toDto(),
        arriveBy = arriveBy,
        stopTimes = stopTimes.map { it.toDto(arriveBy) },
        nextPageCursor = nextPageCursor.ifBlank { null },
        previousPageCursor = previousPageCursor.ifBlank { null },
    )

fun Leg.toDto(): LegDto =
    LegDto(
        mode = mode.label(),
        from = from.toDto(),
        to = to.toDto(),
        startTime = startTime.toString(),
        endTime = endTime.toString(),
        scheduledStartTime = scheduledStartTime.toString(),
        scheduledEndTime = scheduledEndTime.toString(),
        durationSeconds = duration,
        realTime = realTime,
        distanceMeters = distance,
        line = listOf(displayName, routeShortName, routeLongName).firstOrNull { !it.isNullOrBlank() },
        headsign = headsign?.ifBlank { null } ?: tripTo?.name.takeIf { tripId != null },
        routeColor = color(routeColor),
        routeTextColor = color(routeTextColor),
        agency = agencyName,
        tripId = tripId,
        intermediateStops = intermediateStops?.map { it.toDto() },
        polyline = legGeometry.toDto(),
    )

fun Itinerary.toDto(): ItineraryDto =
    ItineraryDto(
        startTime = startTime.toString(),
        endTime = endTime.toString(),
        durationSeconds = duration,
        transfers = transfers,
        legs = legs.map { it.toDto() },
    )

fun RoutingClient.PlanResponseBody.toDto(): JourneyResult =
    JourneyResult(
        from = from.toDto(),
        to = to.toDto(),
        itineraries = itineraries.map { it.toDto() },
        direct = direct.map { it.toDto() },
        nextPageCursor = nextPageCursor.ifBlank { null },
        previousPageCursor = previousPageCursor.ifBlank { null },
    )

fun Reachable.toDto(origin: PlaceDto, maxTravelTimeMinutes: Int): ReachabilityResult {
    val reachable = all.orEmpty().filter { it.place != null }.sortedBy { it.duration ?: Long.MAX_VALUE }
    return ReachabilityResult(
        origin = one?.toDto() ?: origin,
        maxTravelTimeMinutes = maxTravelTimeMinutes,
        places =
            reachable.take(MAX_REACHABLE).map {
                val place = requireNotNull(it.place)
                ReachablePlaceDto(place.name, place.lat, place.lon, place.stopId, it.duration, it.k?.let { k -> k - 1 })
            },
        totalPlaces = reachable.size,
    )
}

/** Approximate distance in km (equirectangular): ranks the points of an area. */
fun distanceKm(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
    val x = (lon2 - lon1) * kotlin.math.cos(Math.toRadians((lat1 + lat2) / 2))
    val y = lat2 - lat1
    return kotlin.math.sqrt(x * x + y * y) * 111.32
}

fun MapClient.RentalsResponseBody.toDto(title: String, bbox: BoundingBox?): RentalsResult {
    val (areaStations, stations) = stations.partition { it.numVehiclesAvailable > AREA_STATION_MIN_VEHICLES }
    val byDistance: (Double, Double) -> Double = { lat, lon -> bbox?.let { distanceKm(it.centerLat, it.centerLon, lat, lon) } ?: 0.0 }
    val vehicles = vehicles.sortedBy { byDistance(it.lat, it.lon) }
    return RentalsResult(
        title = title,
        bbox = bbox?.toDto(),
        providers =
            providers.map { p ->
                RentalProviderDto(
                    id = p.id,
                    name = p.name,
                    groupId = p.groupId,
                    operator = p.`operator`?.ifBlank { null },
                    url = p.url?.ifBlank { null },
                    color = color(p.color),
                    formFactors = p.formFactors.map { it.serialName() },
                    stations = stations.count { it.providerId == p.id },
                    vehicles = vehicles.count { it.providerId == p.id },
                    areaVehicles = areaStations.filter { it.providerId == p.id }.sumOf { it.numVehiclesAvailable },
                )
            },
        stations =
            stations.sortedBy { byDistance(it.lat, it.lon) }.take(MAX_POINTS).map { s ->
                RentalStationDto(
                    id = s.id,
                    name = s.name,
                    lat = s.lat,
                    lon = s.lon,
                    providerId = s.providerId,
                    vehiclesAvailable = s.numVehiclesAvailable,
                    docksAvailable = s.vehicleDocksAvailable.values.takeIf { it.isNotEmpty() }?.sum(),
                    distanceKm = bbox?.let { distanceKm(it.centerLat, it.centerLon, s.lat, s.lon) },
                    formFactors = s.formFactors.map { it.serialName() },
                    isRenting = s.isRenting,
                )
            },
        vehicles =
            vehicles.take(MAX_POINTS).map { v ->
                RentalVehicleDto(
                    id = v.id,
                    lat = v.lat,
                    lon = v.lon,
                    providerId = v.providerId,
                    formFactor = v.formFactor.serialName(),
                    propulsion = v.propulsionType.serialName(),
                    available = !v.isDisabled && !v.isReserved,
                )
            },
        totalStations = stations.size,
        totalVehicles = vehicles.size,
    )
}
