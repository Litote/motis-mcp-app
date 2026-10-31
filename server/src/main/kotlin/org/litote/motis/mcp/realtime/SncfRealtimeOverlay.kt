@file:OptIn(ExperimentalSerializationApi::class)

package org.litote.motis.mcp.realtime

import io.github.oshai.kotlinlogging.KotlinLogging
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.prepareGet
import io.ktor.client.statement.bodyAsBytes
import io.ktor.client.statement.bodyAsChannel
import io.ktor.http.HttpHeaders
import io.ktor.http.isSuccess
import io.ktor.utils.io.jvm.javaio.toInputStream
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.protobuf.ProtoBuf
import org.litote.motis.client.model.Place
import org.litote.motis.client.model.StopTime
import org.litote.motis.mcp.TtlCache
import kotlin.time.Duration
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds
import kotlin.time.Instant
import kotlin.time.TimeMark
import kotlin.time.TimeSource
import kotlin.time.measureTimedValue

private val logger = KotlinLogging.logger {}

/**
 * Real time of the SNCF trains (TGV, Intercités, TER) from the open data of the SNCF, for their stop times without real
 * time in Transitous: those of the `fr-horaires-sncf` feed, and of the regional feeds of TER taken from the NeTEx of the
 * SNCF (e.g. ZOU ! in Provence), told by their trip id. Times and cancellations come from the GTFS-RT trip updates, tracks
 * from the SIRI Lite estimated timetable (the GTFS-RT feed has none, nor the timetable of Transitous).
 *
 * Transitous imports the timetable of the SNCF from its NeTEx export: its trip and stop ids are not those of these feeds.
 * A stop time is matched by its train number and its scheduled time at the stop, the same in all the sources (the trip id
 * of the GTFS-RT feed starts with the train number, e.g. `OCESN5537F…`, SIRI gives it in `TrainNumberRef`); it is left as
 * it is when no trip of a feed, or more than one, matches. The feeds only have the trips running or leaving within about
 * an hour, and the tracks are only known shortly before the departure.
 *
 * Each feed is downloaded at most once a TTL by a process or a Lambda instance (the GTFS-RT one, about 1 MB, every
 * minute; the SIRI one, about 16 MB, every 3 minutes). A feed that fails or is too slow is not used for 5 minutes,
 * without disabling the other one.
 */
class SncfRealtimeOverlay(
    private val httpClient: HttpClient,
    private val userAgent: String?,
    private val url: String = FEED_URL,
    private val tracksUrl: String = TRACKS_URL,
    timeSource: TimeSource = TimeSource.Monotonic,
    /** Dispatcher of the blocking reading of the SIRI feed. */
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
) : RealtimeOverlay {
    override val source: String = "SNCF GTFS-RT"

    private val tripUpdates = CachedFeed("SNCF GTFS-RT", ttl = 1.minutes, timeout = 3.seconds, timeSource) { TrainIndex(fetch()) }
    private val tracks = CachedFeed("SNCF SIRI Lite", ttl = 3.minutes, timeout = 6.seconds, timeSource) { fetchTracks() }

    override suspend fun patch(stopTimes: List<StopTime>): Map<Int, StopTime> {
        val candidates = stopTimes.withIndex().filter { (_, st) -> !st.realTime && SNCF_TRIP.containsMatchIn(st.tripId) }
        if (candidates.isEmpty()) return emptyMap()
        val (trips, tracks) =
            coroutineScope {
                val trips = async { tripUpdates.get() }
                val tracks = async { tracks.get() }
                trips.await() to tracks.await()
            }
        if (trips == null && tracks == null) return emptyMap()
        var times = 0
        var withTracks = 0
        val patched =
            candidates
                .mapNotNull { (i, st) ->
                    val timed = trips?.patch(st)?.also { times++ } ?: st
                    val tracked = tracks?.patch(timed)?.also { withTracks++ } ?: timed
                    tracked.takeIf { it !== st }?.let { i to it }
                }.toMap()
        // all the stop times of the feed without real time: MOTIS has it again when there are none
        logger.info { "SNCF real time: ${candidates.size} stop times without real time, $times with times, $withTracks with tracks" }
        return patched
    }

    private suspend fun fetch(): FeedMessage {
        val response = httpClient.get(url) { userAgent?.let { header(HttpHeaders.UserAgent, it) } }
        check(response.status.isSuccess()) { "HTTP status ${response.status.value}" }
        val feed = ProtoBuf.decodeFromByteArray(FeedMessage.serializer(), response.bodyAsBytes())
        logger.info { "SNCF real time: ${feed.entity.size} trips (feed of ${Instant.fromEpochSeconds(feed.header.timestamp)})" }
        return feed
    }

    private suspend fun fetchTracks(): TrackIndex =
        httpClient.prepareGet(tracksUrl) { userAgent?.let { header(HttpHeaders.UserAgent, it) } }.execute { response ->
            check(response.status.isSuccess()) { "HTTP status ${response.status.value}" }
            val channel = response.bodyAsChannel()
            // blocking parser, read in a stream rather than loaded in memory
            val (index, duration) = withContext(ioDispatcher) { measureTimedValue { channel.toInputStream().use(TrackIndex::parse) } }
            logger.info { "SNCF tracks: ${index.size} journeys, read in $duration" }
            index
        }

    companion object {
        const val FEED_URL = "https://proxy.transport.data.gouv.fr/resource/sncf-gtfs-rt-trip-updates"
        const val TRACKS_URL = "https://proxy.transport.data.gouv.fr/resource/sncf-siri-lite-estimated-timetable"

        /**
         * Trip of the SNCF in Transitous, of the `fr-horaires-sncf` feed or of a regional one: its NeTEx id is a service
         * journey of the SNCF, e.g. `<date>_<time>_fr-horaires-sncf_FR:ServiceJourney::SN6823FERRE_…` or
         * `<date>_<time>_fr-trains-express-regionaux-zou-…_SNC:FR:ServiceJourney::SN17703FERRE_…`.
         */
        private val SNCF_TRIP = Regex("""ServiceJourney::SN\d""")
    }
}

/**
 * Feed loaded at most once a [ttl]. When it fails or does not load within [timeout], it is not used for [retryDelay]:
 * [get] returns null.
 */
internal class CachedFeed<T : Any>(
    private val name: String,
    ttl: Duration,
    private val timeout: Duration,
    private val timeSource: TimeSource,
    private val retryDelay: Duration = 5.minutes,
    private val load: suspend () -> T,
) {
    private val cache = TtlCache<Unit, T>(maxSize = 1, ttl = ttl, timeSource)

    @Volatile
    private var disabledUntil: TimeMark? = null

    suspend fun get(): T? {
        if (disabledUntil?.hasNotPassedNow() == true) return null
        return try {
            cache.getOrPut(Unit) { withTimeout(timeout) { load() } }
        } catch (e: TimeoutCancellationException) {
            disable("no answer within $timeout")
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            disable(e.toString())
        }
    }

    private fun disable(reason: String): Nothing? {
        logger.warn { "$name unavailable ($reason): disabled for $retryDelay" }
        disabledUntil = timeSource.markNow() + retryDelay
        return null
    }
}

/** Trips of a GTFS-RT feed of the SNCF by train number, their stop time updates by scheduled time. */
internal class TrainIndex(feed: FeedMessage) {
    private class Trip(val cancelled: Boolean, val departures: Map<Instant, StopTimeUpdate>, val arrivals: Map<Instant, StopTimeUpdate>) {
        /** [place] of the trip with its estimated times, matched by scheduled time: unchanged when not found. */
        fun withRealTime(place: Place): Place {
            val departure = place.scheduledDeparture?.let { departures[it] }
            val arrival = place.scheduledArrival?.let { arrivals[it] }
            if (departure == null && arrival == null) return place
            return place.copy(
                departure = departure?.departure?.estimated() ?: place.departure,
                arrival = arrival?.arrival?.estimated() ?: place.arrival,
                cancelled = (departure ?: arrival)?.scheduleRelationship == StopTimeUpdate.SKIPPED || place.cancelled == true,
            )
        }
    }

    private val trips: Map<String, List<Trip>> =
        feed.entity
            .mapNotNull { it.tripUpdate }
            .mapNotNull { tu ->
                val number = TRAIN_NUMBER.find(tu.trip.tripId)?.groupValues?.get(1) ?: return@mapNotNull null
                number to
                    Trip(
                        cancelled = tu.trip.scheduleRelationship == TripDescriptor.CANCELED,
                        departures = tu.stopTimeUpdate.bySchedule { it.departure },
                        arrivals = tu.stopTimeUpdate.bySchedule { it.arrival },
                    )
            }.groupBy({ it.first }, { it.second })

    /** [stopTime] with the real time of its trip, null when no trip of the feed, or more than one, matches. */
    fun patch(stopTime: StopTime): StopTime? {
        val number = stopTime.tripShortName.trimStart('0').takeIf { it.isNotEmpty() && it.all(Char::isDigit) } ?: return null
        val departure = stopTime.place.scheduledDeparture
        val arrival = stopTime.place.scheduledArrival
        val trip =
            trips[number]
                ?.filter { if (departure != null) departure in it.departures else arrival != null && arrival in it.arrivals }
                ?.singleOrNull()
                ?: return null
        val update = departure?.let { trip.departures[it] } ?: trip.arrivals.getValue(checkNotNull(arrival))
        return stopTime.copy(
            realTime = true,
            cancelled = stopTime.cancelled || update.scheduleRelationship == StopTimeUpdate.SKIPPED,
            tripCancelled = stopTime.tripCancelled || trip.cancelled,
            place = trip.withRealTime(stopTime.place),
            nextStops = stopTime.nextStops?.map(trip::withRealTime),
            previousStops = stopTime.previousStops?.map(trip::withRealTime),
        )
    }

    private companion object {
        /** `OCE` + 2 letters (SN: train, SA, EA, LO: TER and coaches) + train number, e.g. `OCESN5537F…`. */
        val TRAIN_NUMBER = Regex("""^OCE[A-Z]{2}0*(\d+)""")

        fun StopTimeEvent.estimated(): Instant? = time.takeIf { it != 0L }?.let(Instant::fromEpochSeconds)

        fun StopTimeEvent.scheduled(): Instant? = time.takeIf { it != 0L }?.let { Instant.fromEpochSeconds(it - delay) }

        /** Updates by scheduled time of [event]; a time shared by several stops of the trip matches none of them. */
        fun List<StopTimeUpdate>.bySchedule(event: (StopTimeUpdate) -> StopTimeEvent?): Map<Instant, StopTimeUpdate> =
            mapNotNull { u -> event(u)?.scheduled()?.let { it to u } }
                .groupBy({ it.first }, { it.second })
                .mapNotNull { (time, updates) -> updates.singleOrNull()?.let { time to it } }
                .toMap()
    }
}
