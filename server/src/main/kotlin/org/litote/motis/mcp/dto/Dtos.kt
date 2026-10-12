package org.litote.motis.mcp.dto

import kotlinx.serialization.Serializable

// Compact DTOs sent as `structuredContent`: they are read by the views and by the model,
// so they only keep the fields useful to display or reason about the data.
// Every result carries a `kind` used by the views to select the rendering.

@Serializable
data class Coordinates(val lat: Double, val lon: Double)

@Serializable
data class Bbox(val minLat: Double, val minLon: Double, val maxLat: Double, val maxLon: Double)

/** Encoded polyline (Google format) with its [precision] (5 or 6 decimals). */
@Serializable
data class Polyline(val points: String, val precision: Int = 6)

@Serializable
data class PlaceDto(
    val name: String,
    val lat: Double,
    val lon: Double,
    val stopId: String? = null,
    val modes: List<String>? = null,
    val track: String? = null,
    val arrival: String? = null,
    val departure: String? = null,
    val scheduledArrival: String? = null,
    val scheduledDeparture: String? = null,
    val cancelled: Boolean? = null,
    val tz: String? = null,
)

// --- search_places ---

@Serializable
data class PlaceMatchDto(
    val id: String,
    val name: String,
    val type: String,
    val lat: Double,
    val lon: Double,
    val area: String? = null,
    val modes: List<String>? = null,
)

@Serializable
data class SearchResult(val kind: String = "search", val query: String, val matches: List<PlaceMatchDto>)

// --- server_info ---

@Serializable
data class ServerInfoResult(
    val kind: String = "serverInfo",
    val baseUrl: String,
    val motisVersion: String,
    val realTime: Boolean?,
    val gbfs: Boolean?,
    val hasElevation: Boolean,
    val hasStreetRouting: Boolean,
    val maxOneToAllTravelTimeMinutes: Double,
    val initialView: Coordinates,
    val initialZoom: Double,
)

// --- explore_area / route_details ---

@Serializable
data class RouteDto(
    val routeIdx: Long,
    val mode: String,
    val names: List<String>,
    val color: String? = null,
    val textColor: String? = null,
    val numStops: Long,
    /** Number of MOTIS routes (stop sequences) grouped in this line. */
    val variants: Int = 1,
)

@Serializable
data class RoutePolylineDto(val polyline: Polyline, val color: String? = null, val routeIdx: List<Long>)

@Serializable
data class AreaResult(
    val kind: String,
    val title: String,
    val bbox: Bbox,
    val zoom: Double,
    val stops: List<PlaceDto>,
    val routes: List<RouteDto>,
    val polylines: List<RoutePolylineDto>,
    val totalStops: Int,
    val totalRoutes: Int,
    val zoomFiltered: Boolean = false,
)

// --- reachability ---

@Serializable
data class ReachablePlaceDto(
    val name: String,
    val lat: Double,
    val lon: Double,
    val stopId: String? = null,
    val durationMinutes: Long? = null,
    val transfers: Long? = null,
)

@Serializable
data class ReachabilityResult(
    val kind: String = "reachability",
    val origin: PlaceDto,
    val maxTravelTimeMinutes: Int,
    val places: List<ReachablePlaceDto>,
    val totalPlaces: Int,
)

// --- departures / trip_details ---

@Serializable
data class StopTimeDto(
    val time: String?,
    val scheduledTime: String?,
    val realTime: Boolean,
    val cancelled: Boolean,
    val mode: String,
    val line: String,
    val headsign: String,
    val routeColor: String? = null,
    val routeTextColor: String? = null,
    val track: String? = null,
    val agency: String,
    val tripId: String,
)

@Serializable
data class DeparturesResult(
    val kind: String = "departures",
    val stop: PlaceDto,
    val arriveBy: Boolean,
    val stopTimes: List<StopTimeDto>,
    val nextPageCursor: String? = null,
    val previousPageCursor: String? = null,
)

@Serializable
data class LegDto(
    val mode: String,
    val from: PlaceDto,
    val to: PlaceDto,
    val startTime: String,
    val endTime: String,
    val scheduledStartTime: String,
    val scheduledEndTime: String,
    val durationSeconds: Long,
    val realTime: Boolean,
    val distanceMeters: Double? = null,
    val line: String? = null,
    val headsign: String? = null,
    val routeColor: String? = null,
    val routeTextColor: String? = null,
    val agency: String? = null,
    val tripId: String? = null,
    val intermediateStops: List<PlaceDto>? = null,
    val polyline: Polyline,
)

@Serializable
data class ItineraryDto(
    val startTime: String,
    val endTime: String,
    val durationSeconds: Long,
    val transfers: Long,
    val legs: List<LegDto>,
)

@Serializable
data class TripResult(val kind: String = "trip", val tripId: String, val itinerary: ItineraryDto)

// --- plan_journey ---

@Serializable
data class JourneyResult(
    val kind: String = "journey",
    val from: PlaceDto,
    val to: PlaceDto,
    val itineraries: List<ItineraryDto>,
    val direct: List<ItineraryDto>,
    val nextPageCursor: String? = null,
    val previousPageCursor: String? = null,
)

// --- rentals ---

@Serializable
data class RentalProviderDto(
    val id: String,
    val name: String,
    val groupId: String,
    val operator: String? = null,
    val url: String? = null,
    val color: String? = null,
    val formFactors: List<String>,
    /** Stations in the area: docking stations, or parking spots of free-floating operators. */
    val stations: Int,
    /** Free-floating vehicles in the area. */
    val vehicles: Int,
    /** Vehicles reported by area-wide virtual stations, not located (see AREA_STATION_MIN_VEHICLES). */
    val areaVehicles: Long = 0,
)

@Serializable
data class RentalStationDto(
    val id: String,
    val name: String,
    val lat: Double,
    val lon: Double,
    val providerId: String,
    val vehiclesAvailable: Long,
    /** Free docks, when the provider reports them. */
    val docksAvailable: Long? = null,
    val formFactors: List<String>,
    val isRenting: Boolean,
    /** Distance to the center of the area, in km. */
    val distanceKm: Double? = null,
)

@Serializable
data class RentalVehicleDto(
    val id: String,
    val lat: Double,
    val lon: Double,
    val providerId: String,
    val formFactor: String,
    val propulsion: String,
    val available: Boolean,
)

@Serializable
data class RentalsResult(
    val kind: String = "rentals",
    val title: String,
    val bbox: Bbox?,
    val providers: List<RentalProviderDto>,
    val stations: List<RentalStationDto>,
    val vehicles: List<RentalVehicleDto>,
    val totalStations: Int,
    val totalVehicles: Int,
)
