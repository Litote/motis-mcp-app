package org.litote.motis.mcp.cities

import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.litote.motis.mcp.MotisGateway
import org.litote.motis.mcp.MotisToolException
import org.litote.motis.mcp.PlanQuery
import org.litote.motis.mcp.ResolvedPlace
import org.litote.motis.mcp.dto.Coordinates
import org.litote.motis.mcp.dto.JourneyResult
import org.litote.motis.mcp.dto.PlaceDto
import org.litote.motis.mcp.dto.cityStations
import org.litote.motis.mcp.dto.fromMainLineStations
import org.litote.motis.mcp.dto.merged
import org.litote.motis.mcp.dto.toDto
import java.time.Instant
import kotlin.io.encoding.Base64
import kotlin.time.Duration
import kotlin.time.Duration.Companion.days
import kotlin.time.toJavaDuration

private val logger = KotlinLogging.logger {}

/**
 * Journeys between two cities asked by name (e.g. Paris to Nantes), from station to station.
 *
 * The stations of a pair of cities are found once from the journeys between the city centers ([discover]: the first
 * station of each long-distance itinerary in the city of departure, the last one in the city of arrival), then kept in
 * the [store] for [refreshAfter]. The next journeys are searched from each station of departure to each station of
 * arrival (at most [MAX_STATION_PAIRS] pairs), and merged: the time asked is the departure from the station, not from
 * the center, and each station has its own best trains.
 *
 * The cursor of the merged journeys gathers the cursors of every pair of stations ([StationPairsCursor]).
 */
class CityJourneys(
    private val gateway: MotisGateway,
    private val store: CityStationsStore,
    private val refreshAfter: Duration = 7.days,
    private val now: () -> Instant = Instant::now,
) {
    /** Journeys of [query] (between the centers of [from] and [to]) from station to station. */
    suspend fun plan(from: ResolvedPlace, to: ResolvedPlace, query: PlanQuery): JourneyResult {
        val fromCity = from.center()
        val toCity = to.center()
        val cursor = query.pageCursor
        if (cursor != null) {
            // a cursor of the journeys between the centers (discovery), else of the pairs of stations
            val pairs = StationPairsCursor.decode(cursor) ?: return gateway.plan(query).toDto().fromMainLineStations(fromCity, toCity)
            return planPairs(from, to, query, pairs.pairs)
        }
        val key = "${from.id}>${to.id}"
        val known = load(key)?.takeIf { java.time.Duration.between(it.discoveredAt, now()) < refreshAfter.toJavaDuration() }
        return if (known == null) {
            discover(key, fromCity, toCity, query)
        } else {
            planPairs(from, to, query, stationPairs(known.from, known.to).map { (f, t) -> StationPair(f, t) })
        }
    }

    /**
     * Journeys between the city centers, cut at the stations; their stations are kept for the next journeys. Nothing is
     * kept without station: no long-distance train at this time does not tell there are none (e.g. only coaches at night).
     */
    private suspend fun discover(key: String, fromCity: Coordinates, toCity: Coordinates, query: PlanQuery): JourneyResult {
        val journeys =
            gateway
                .plan(query.copy(numItineraries = maxOf(query.numItineraries ?: 0, DISCOVERY_ITINERARIES)))
                .toDto()
                .fromMainLineStations(fromCity, toCity)
        val (fromStations, toStations) = journeys.cityStations(fromCity, toCity)
        if (fromStations.isNotEmpty() && toStations.isNotEmpty()) save(key, CityStations(fromStations, toStations, now()))
        return journeys
    }

    private suspend fun planPairs(from: ResolvedPlace, to: ResolvedPlace, query: PlanQuery, pairs: List<StationPair>): JourneyResult {
        val fromCity = from.center()
        val toCity = to.center()
        val results =
            coroutineScope {
                pairs
                    .map { pair ->
                        async {
                            pair to
                                try {
                                    Result.success(gateway.plan(query.copy(from = pair.from, to = pair.to, pageCursor = pair.cursor)))
                                } catch (e: MotisToolException) {
                                    Result.failure(e)
                                }
                        }
                    }.awaitAll()
            }
        val succeeded = results.mapNotNull { (pair, result) -> result.getOrNull()?.let { pair to it.toDto() } }
        if (succeeded.isEmpty()) throw results.first().second.exceptionOrNull()!!
        results.forEach { (pair, result) ->
            result.exceptionOrNull()?.let { logger.warn { "Journeys from ${pair.from} to ${pair.to} left out: ${it.message}" } }
        }
        fun cursor(of: (JourneyResult) -> String?): String? =
            succeeded
                .mapNotNull { (pair, journeys) -> of(journeys)?.let { pair.copy(cursor = it) } }
                .takeIf { it.isNotEmpty() }
                ?.let { StationPairsCursor(it).encode() }
        return JourneyResult(
            from = PlaceDto(from.name, from.lat, from.lon),
            to = PlaceDto(to.name, to.lat, to.lon),
            // cut too: a journey from a station may take a local train to another one (e.g. Montparnasse to Massy)
            itineraries = succeeded.flatMap { (_, journeys) -> journeys.fromMainLineStations(fromCity, toCity).itineraries }.merged(),
            direct = emptyList(),
            nextPageCursor = cursor { it.nextPageCursor },
            previousPageCursor = cursor { it.previousPageCursor },
        )
    }

    /** A failure of the store only costs a discovery: the journeys are still searched. */
    private suspend fun load(key: String): CityStations? =
        try {
            store.get(key)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            logger.warn(e) { "Stations of $key not read: ${e.message}" }
            null
        }

    private suspend fun save(key: String, stations: CityStations) {
        try {
            store.put(key, stations)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            logger.warn(e) { "Stations of $key not saved: ${e.message}" }
        }
    }

    companion object {
        /** Itineraries between the centers of a discovery: several trains, from several stations. */
        const val DISCOVERY_ITINERARIES = 10

        /** Searches of the journeys between two cities (pairs of stations). */
        const val MAX_STATION_PAIRS = 4

        /** Stations of each city at most, the most used first. */
        private const val MAX_STATIONS = 3

        /**
         * Pairs of the most used stations of each city, at most [MAX_STATION_PAIRS]: a station of the city with the
         * most is dropped while there are too many (3 × 3 → 2 × 3 → 2 × 2).
         */
        fun stationPairs(from: List<String>, to: List<String>): List<Pair<String, String>> {
            var fromStations = from.take(MAX_STATIONS)
            var toStations = to.take(MAX_STATIONS)
            while (fromStations.size * toStations.size > MAX_STATION_PAIRS) {
                if (fromStations.size >= toStations.size) fromStations = fromStations.dropLast(1) else toStations = toStations.dropLast(1)
            }
            return fromStations.flatMap { f -> toStations.map { t -> f to t } }
        }

        private fun ResolvedPlace.center() = Coordinates(lat, lon)
    }
}

/** A pair of stations, with the MOTIS cursor of its journeys ([cursor] null: the first page). */
@Serializable
data class StationPair(val from: String, val to: String, val cursor: String? = null)

/**
 * Cursor of the journeys between two cities: the cursor of each pair of stations, encoded with the prefix [PREFIX] to
 * tell it from a MOTIS cursor.
 */
@Serializable
data class StationPairsCursor(val pairs: List<StationPair>) {
    fun encode(): String = PREFIX + Base64.UrlSafe.encode(Json.encodeToString(serializer(), this).encodeToByteArray())

    companion object {
        private const val PREFIX = "stations:"

        /** The cursor of the pairs of stations, null for another cursor (of MOTIS). */
        fun decode(cursor: String): StationPairsCursor? {
            if (!cursor.startsWith(PREFIX)) return null
            return try {
                Json.decodeFromString(serializer(), Base64.UrlSafe.decode(cursor.removePrefix(PREFIX)).decodeToString())
                    .takeIf { it.pairs.isNotEmpty() }
            } catch (e: IllegalArgumentException) {
                null
            } ?: throw MotisToolException("Invalid argument: 'pageCursor' is not a cursor returned by plan_journey")
        }
    }
}
