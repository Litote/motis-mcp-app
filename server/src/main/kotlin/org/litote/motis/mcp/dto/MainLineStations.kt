package org.litote.motis.mcp.dto

import java.time.Duration
import java.time.Instant

/** Modes of the long-distance trains, whose stations are the ends of the journeys asked between cities. */
private val MAIN_LINE_MODES = setOf("HIGHSPEED_RAIL", "LONG_DISTANCE", "NIGHT_RAIL")

/** Trains bringing to or from a long-distance train, e.g. a regional train from Le Mans to Nantes after a TGV. */
private val RAIL_MODES = MAIN_LINE_MODES + setOf("RAIL", "REGIONAL_FAST_RAIL", "REGIONAL_RAIL")

/**
 * Distance from the center of a city within which its stations are: Massy TGV for Paris (16 km), not Le Mans for
 * Nantes.
 */
private const val CITY_STATIONS_KM = 25.0

/** Long-distance station of a city beyond [CITY_STATIONS_KM], known by name: [city] is its center as geocoded. */
private class OuterStation(val name: String, val city: Coordinates, val station: Coordinates)

/** Distance from its geocoded center within which a city has its [OuterStation]s. */
private const val OUTER_STATION_CITY_KM = 5.0

/** Distance from an [OuterStation] of its stops: platforms, regional trains, stops of the other feeds. */
private const val OUTER_STATION_KM = 1.0

private val OUTER_STATIONS =
    listOf(
        // 32 km from the center; Massy TGV (16 km) and Aéroport CDG TGV (23 km) are within CITY_STATIONS_KM
        OuterStation("Marne-la-Vallée – Chessy", city = Coordinates(48.8535, 2.3484), station = Coordinates(48.8700, 2.7826)),
    )

/**
 * Journeys from (with [fromCity], the center of the city of departure) and to (with [toCity]) the long-distance
 * stations of the cities asked, not their centers: the legs before the first long-distance train and after the last one
 * (walk, metro, bus) are left out. MOTIS already picks the best station of the city from its center.
 *
 * A journey is only cut at a station of the city: when the long-distance train stops away from it (e.g. a TGV to Le
 * Mans, then a regional train to Nantes), the trains to the city are kept. The itineraries without long-distance train
 * (e.g. to a suburb) are kept as is. The itineraries made the same by the cut (same trains, reached by different local
 * lines) are merged.
 */
fun JourneyResult.fromMainLineStations(fromCity: Coordinates?, toCity: Coordinates?): JourneyResult {
    if (fromCity == null && toCity == null) return this
    return copy(itineraries = itineraries.map { it.fromMainLineStations(fromCity, toCity) }.merged())
}

/** True when an itinerary of the journey takes a long-distance train. */
fun JourneyResult.hasMainLineLegs(): Boolean = itineraries.any { it.hasMainLineLegs() }

/**
 * Stations of the cities used by the long-distance itineraries cut by [fromMainLineStations], most used first: the
 * first stop of the itineraries starting with a train in the city of departure, and the last stop of those ending with
 * a train in the city of arrival.
 */
fun JourneyResult.cityStations(fromCity: Coordinates, toCity: Coordinates): Pair<List<String>, List<String>> {
    val mainLine = itineraries.filter { it.hasMainLineLegs() }
    fun List<String?>.byUse() = filterNotNull().groupingBy { it }.eachCount().entries.sortedByDescending { it.value }.map { it.key }
    return mainLine
        .map { it.legs.first() }
        .map { leg -> leg.from.stopId.takeIf { leg.isTransit() && leg.from.isNear(fromCity) } }
        .byUse() to
        mainLine
            .map { it.legs.last() }
            .map { leg -> leg.to.stopId.takeIf { leg.isTransit() && leg.to.isNear(toCity) } }
            .byUse()
}

/**
 * The itineraries taking the same vehicles once, the shortest (e.g. made the same by the cut, or found from two
 * stations), sorted by departure. An itinerary taking the vehicles of another one and more is left out (e.g. a TGV from
 * Massy TGV to Paris Montparnasse, then the TGV from Paris Montparnasse to Nantes, found with that TGV alone).
 */
fun List<ItineraryDto>.merged(): List<ItineraryDto> {
    val distinct = sortedBy { it.durationSeconds }.distinctBy { it.transitKey() }
    val keys = distinct.map { it.transitKey() }
    return distinct
        .filterIndexed { i, _ -> keys.none { other -> other.size in 1..<keys[i].size && keys[i].containsInOrder(other) } }
        .sortedBy { Instant.parse(it.startTime) }
}

/** True when [part] is a run of consecutive elements of this list. */
private fun <T> List<T>.containsInOrder(part: List<T>): Boolean = (0..size - part.size).any { subList(it, it + part.size) == part }

private fun ItineraryDto.hasMainLineLegs(): Boolean = legs.any { it.mode in MAIN_LINE_MODES }

private fun ItineraryDto.fromMainLineStations(fromCity: Coordinates?, toCity: Coordinates?): ItineraryDto {
    val firstMainLine = legs.indexOfFirst { it.mode in MAIN_LINE_MODES }
    if (firstMainLine < 0) return this
    val lastMainLine = legs.indexOfLast { it.mode in MAIN_LINE_MODES }
    // the last train leaving the city up to the first long-distance one, the first one reaching the city from the last
    val start =
        fromCity
            ?.let { city -> (firstMainLine downTo 0).firstOrNull { legs[it].mode in RAIL_MODES && legs[it].from.isNear(city) } }
            ?: 0
    val end =
        toCity
            ?.let { city -> (lastMainLine..legs.lastIndex).firstOrNull { legs[it].mode in RAIL_MODES && legs[it].to.isNear(city) } }
            ?: legs.lastIndex
    val kept = legs.subList(start, end + 1)
    if (kept.size == legs.size) return this
    // each transit leg left out was one more transfer
    val transitLegsLeftOut = legs.count { it.isTransit() } - kept.count { it.isTransit() }
    val startTime = kept.first().startTime
    val endTime = kept.last().endTime
    return copy(
        startTime = startTime,
        endTime = endTime,
        durationSeconds = Duration.between(Instant.parse(startTime), Instant.parse(endTime)).seconds,
        transfers = (transfers - transitLegsLeftOut).coerceAtLeast(0),
        legs = kept,
    )
}

/** A stop of the city: within [CITY_STATIONS_KM] of its center, or of one of its [OUTER_STATIONS]. */
private fun PlaceDto.isNear(city: Coordinates): Boolean =
    distanceKm(lat, lon, city.lat, city.lon) <= CITY_STATIONS_KM ||
        OUTER_STATIONS.any { outer ->
            distanceKm(city.lat, city.lon, outer.city.lat, outer.city.lon) <= OUTER_STATION_CITY_KM &&
                distanceKm(lat, lon, outer.station.lat, outer.station.lon) <= OUTER_STATION_KM
        }

private fun LegDto.isTransit(): Boolean = tripId != null

/** Trips of the itinerary and their stops: the same for the itineraries taking the same vehicles. */
private fun ItineraryDto.transitKey(): List<Any?> =
    legs.filter { it.isTransit() }.map { listOf(it.tripId, it.from.stopId ?: it.from.name, it.to.stopId ?: it.to.name) }
