@file:OptIn(ExperimentalSerializationApi::class)

package org.litote.motis.mcp.realtime

import io.github.oshai.kotlinlogging.KotlinLogging
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.statement.bodyAsBytes
import io.ktor.http.HttpHeaders
import io.ktor.http.isSuccess
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.protobuf.ProtoBuf
import org.litote.motis.client.model.Alert
import org.litote.motis.client.model.AlertCause
import org.litote.motis.client.model.AlertEffect
import org.litote.motis.client.model.Itinerary
import org.litote.motis.client.model.Leg
import org.litote.motis.client.model.StopTime
import org.litote.motis.client.model.TimeRange
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds
import kotlin.time.Instant
import kotlin.time.TimeSource

private val logger = KotlinLogging.logger {}

/**
 * Service alerts of the SNCF trains (TGV, Intercités, TER) from the GTFS-RT feed of the SNCF: Transitous has none for
 * them. They are added to the alerts of their trips in the results of MOTIS (stop times, legs), then filtered and mapped
 * as the others (see [org.litote.motis.mcp.dto.activeAlerts]).
 *
 * The alerts of the feed name a train (its trip id, without date, e.g. `OCESN849606F`), sometimes with the stops concerned:
 * these stops are not matched (the stop ids of Transitous are not those of the feed), the alert is given to the whole
 * trip, its text names the stations. The texts are translated (fr, en, de, es, it, nl): the language asked is chosen,
 * else French.
 *
 * The feed (about 600 kB) is downloaded at most once every 2 minutes by a process or a Lambda instance, only for a
 * result with SNCF trains; when it fails or is too slow, it is not used for 5 minutes.
 */
class SncfAlerts(
    private val httpClient: HttpClient,
    private val userAgent: String?,
    private val url: String = FEED_URL,
    timeSource: TimeSource = TimeSource.Monotonic,
) {
    private val feed = CachedFeed("SNCF GTFS-RT alerts", ttl = 2.minutes, timeout = 3.seconds, timeSource) { SncfAlertIndex(fetch()) }

    /** [stopTimes] with the alerts of their SNCF trains added to those of their place. Never fails: unchanged instead. */
    suspend fun addToStopTimes(stopTimes: List<StopTime>, language: List<String>?): List<StopTime> {
        if (stopTimes.none { SncfTrains.isSncfTrip(it.tripId) }) return stopTimes
        val index = feed.get() ?: return stopTimes
        return stopTimes.map { st ->
            val alerts = if (SncfTrains.isSncfTrip(st.tripId)) index.alerts(st.tripShortName, language) else emptyList()
            if (alerts.isEmpty()) st else st.copy(place = st.place.copy(alerts = st.place.alerts.orEmpty() + alerts))
        }
    }

    /** [itineraries] with the alerts of their SNCF trains added to those of their legs. Never fails: unchanged instead. */
    suspend fun addToItineraries(itineraries: List<Itinerary>, language: List<String>?): List<Itinerary> {
        if (itineraries.none { it.legs.any(Leg::isSncf) }) return itineraries
        val index = feed.get() ?: return itineraries
        return itineraries.map { if (it.legs.any(Leg::isSncf)) it.copy(legs = it.legs.map { leg -> leg.withAlerts(index, language) }) else it }
    }

    private suspend fun fetch(): FeedMessage {
        val response = httpClient.get(url) { userAgent?.let { header(HttpHeaders.UserAgent, it) } }
        check(response.status.isSuccess()) { "HTTP status ${response.status.value}" }
        val feed = ProtoBuf.decodeFromByteArray(FeedMessage.serializer(), response.bodyAsBytes())
        logger.info { "SNCF alerts: ${feed.entity.count { it.alert != null }} alerts (feed of ${Instant.fromEpochSeconds(feed.header.timestamp)})" }
        return feed
    }

    companion object {
        const val FEED_URL = "https://proxy.transport.data.gouv.fr/resource/sncf-gtfs-rt-service-alerts"
    }
}

private fun Leg.isSncf(): Boolean = SncfTrains.isSncfTrip(tripId)

private fun Leg.withAlerts(index: SncfAlertIndex, language: List<String>?): Leg {
    if (!isSncf()) return this
    val added = index.alerts(tripShortName, language)
    return if (added.isEmpty()) this else copy(alerts = alerts.orEmpty() + added)
}

/** Alerts of a GTFS-RT feed of the SNCF by train number. */
internal class SncfAlertIndex(feed: FeedMessage) {
    private val byTrain: Map<String, List<GtfsAlert>> =
        feed.entity
            .mapNotNull { it.alert }
            .flatMap { alert ->
                alert.informedEntity.mapNotNull { e -> e.trip?.let { SncfTrains.feedNumber(it.tripId) } }.distinct().map { it to alert }
            }.groupBy({ it.first }, { it.second })

    /** Alerts of the train of [tripShortName] (Transitous), in the first of the [language]s translated, else in French. */
    fun alerts(tripShortName: String?, language: List<String>?): List<Alert> =
        SncfTrains.number(tripShortName)?.let { byTrain[it] }.orEmpty().map { it.toMotis(language) }
}

/** GTFS-RT `Cause` and `Effect` values (1 to 12, 1 to 11), in their order. */
private val CAUSES =
    listOf(
        AlertCause.UNKNOWN_CAUSE, AlertCause.OTHER_CAUSE, AlertCause.TECHNICAL_PROBLEM, AlertCause.STRIKE, AlertCause.DEMONSTRATION,
        AlertCause.ACCIDENT, AlertCause.HOLIDAY, AlertCause.WEATHER, AlertCause.MAINTENANCE, AlertCause.CONSTRUCTION,
        AlertCause.POLICE_ACTIVITY, AlertCause.MEDICAL_EMERGENCY,
    )
private val EFFECTS =
    listOf(
        AlertEffect.NO_SERVICE, AlertEffect.REDUCED_SERVICE, AlertEffect.SIGNIFICANT_DELAYS, AlertEffect.DETOUR,
        AlertEffect.ADDITIONAL_SERVICE, AlertEffect.MODIFIED_SERVICE, AlertEffect.OTHER_EFFECT, AlertEffect.UNKNOWN_EFFECT,
        AlertEffect.STOP_MOVED, AlertEffect.NO_EFFECT, AlertEffect.ACCESSIBILITY_ISSUE,
    )

/** The alert as MOTIS gives it: its periods are open when 0 (an end of 0 is read as open, see the mapping of the alerts). */
internal fun GtfsAlert.toMotis(language: List<String>?): Alert =
    Alert(
        headerText = headerText.text(language),
        descriptionText = descriptionText.text(language),
        url = url.text(language).ifBlank { null },
        cause = CAUSES.getOrNull(cause - 1),
        effect = EFFECTS.getOrNull(effect - 1),
        impactPeriod = activePeriod.map { TimeRange(start = Instant.fromEpochSeconds(it.start), end = Instant.fromEpochSeconds(it.end)) },
    )

/** Text in the first of the [language]s translated (`fr-FR` read as `fr`), else in French, else the first one. */
internal fun TranslatedString?.text(language: List<String>?): String {
    val translations = this?.translation.orEmpty()
    fun of(lang: String) = translations.firstOrNull { it.language.substringBefore('-').equals(lang.substringBefore('-'), ignoreCase = true) }
    return (language.orEmpty().firstNotNullOfOrNull(::of) ?: of("fr") ?: translations.firstOrNull())?.text.orEmpty()
}
