@file:OptIn(ExperimentalSerializationApi::class)

package org.litote.motis.mcp.realtime

import io.github.oshai.kotlinlogging.KotlinLogging
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.statement.bodyAsBytes
import io.ktor.http.HttpHeaders
import io.ktor.http.isSuccess
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.protobuf.ProtoBuf
import org.litote.motis.client.model.Place
import org.litote.motis.client.model.StopTime
import org.litote.motis.mcp.TtlCache
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds
import kotlin.time.Instant
import kotlin.time.TimeMark
import kotlin.time.TimeSource

private val logger = KotlinLogging.logger {}

/**
 * Real time of the SNCF trains (TGV, Intercités, TER) from the open GTFS-RT trip updates of the SNCF, for the stop times
 * of the `fr-horaires-sncf` feed of Transitous without real time.
 *
 * Transitous imports the timetable of the SNCF from its NeTEx export: its trip and stop ids are not those of the GTFS-RT
 * feed. A stop time is matched by its train number and its scheduled time at the stop, the same in both sources (the
 * trip id of the feed starts with the train number, e.g. `OCESN5537F…`); it is left as it is when no trip of the feed,
 * or more than one, matches. The feed only has the trips running or leaving within about an hour.
 *
 * The feed (about 1 MB, updated every 2 minutes) is downloaded at most once a [ttl] by a process or a Lambda instance.
 * When it fails or is too slow, the overlay is disabled [retryDelay], the stop times keep their scheduled times.
 */
class SncfRealtimeOverlay(
    private val httpClient: HttpClient,
    private val userAgent: String?,
    private val url: String = FEED_URL,
    private val timeSource: TimeSource = TimeSource.Monotonic,
) : RealtimeOverlay {
    override val source: String = "SNCF GTFS-RT"

    private val ttl = 1.minutes
    private val timeout = 3.seconds
    private val retryDelay = 5.minutes

    private val feed = TtlCache<Unit, TrainIndex>(maxSize = 1, ttl = ttl, timeSource)

    @Volatile
    private var disabledUntil: TimeMark? = null

    override suspend fun patch(stopTimes: List<StopTime>): Map<Int, StopTime> {
        val candidates = stopTimes.withIndex().filter { (_, st) -> !st.realTime && st.tripId.contains("_${FEED_ID}_") }
        if (candidates.isEmpty()) return emptyMap()
        val index = index() ?: return emptyMap()
        val patched = candidates.mapNotNull { (i, st) -> index.patch(st)?.let { i to it } }.toMap()
        // all the stop times of the feed without real time: MOTIS has it again when there are none
        logger.info { "SNCF real time: ${patched.size}/${candidates.size} stop times without real time matched" }
        return patched
    }

    private suspend fun index(): TrainIndex? {
        if (disabledUntil?.hasNotPassedNow() == true) return null
        return try {
            feed.getOrPut(Unit) { withTimeout(timeout) { TrainIndex(fetch()) } }
        } catch (e: TimeoutCancellationException) {
            disable("no answer within $timeout")
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            disable(e.toString())
        }
    }

    private fun disable(reason: String): Nothing? {
        logger.warn { "SNCF real time unavailable ($reason): disabled for $retryDelay" }
        disabledUntil = timeSource.markNow() + retryDelay
        return null
    }

    private suspend fun fetch(): FeedMessage {
        val response = httpClient.get(url) { userAgent?.let { header(HttpHeaders.UserAgent, it) } }
        check(response.status.isSuccess()) { "HTTP status ${response.status.value}" }
        val feed = ProtoBuf.decodeFromByteArray(FeedMessage.serializer(), response.bodyAsBytes())
        logger.info { "SNCF real time: ${feed.entity.size} trips (feed of ${Instant.fromEpochSeconds(feed.header.timestamp)})" }
        return feed
    }

    companion object {
        const val FEED_URL = "https://proxy.transport.data.gouv.fr/resource/sncf-gtfs-rt-trip-updates"

        /** Feed of the SNCF trains in Transitous: its trip ids are `<date>_<time>_fr-horaires-sncf_<NeTEx id>`. */
        const val FEED_ID = "fr-horaires-sncf"
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
