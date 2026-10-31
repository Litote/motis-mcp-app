package org.litote.motis.mcp.realtime

import org.litote.motis.client.model.StopTime
import java.io.InputStream
import javax.xml.stream.XMLInputFactory
import javax.xml.stream.XMLStreamConstants
import kotlin.time.Instant

/**
 * Tracks of the SNCF trains from the SIRI Lite estimated timetable of the SNCF, by train number (`TrainNumberRef`), the
 * tracks of each journey by aimed time. The tracks are only known shortly before the departure.
 */
internal class TrackIndex(private val journeys: Map<String, List<Journey>>) {
    /** Tracks by aimed time, null when not known yet; a time shared by several calls of the journey matches none of them. */
    class Journey(val departures: Map<Instant, String?>, val arrivals: Map<Instant, String?>)

    val size: Int get() = journeys.values.sumOf { it.size }

    /** [stopTime] with the track of its journey, null when it has one or when no journey, or more than one, matches. */
    fun patch(stopTime: StopTime): StopTime? {
        if (stopTime.place.track != null || stopTime.place.scheduledTrack != null) return null
        val number = stopTime.tripShortName.trimStart('0').takeIf { it.isNotEmpty() && it.all(Char::isDigit) } ?: return null
        val departure = stopTime.place.scheduledDeparture
        val arrival = stopTime.place.scheduledArrival
        val journey =
            journeys[number]
                ?.filter { if (departure != null) departure in it.departures else arrival != null && arrival in it.arrivals }
                ?.singleOrNull()
                ?: return null
        val track = (if (departure != null) journey.departures[departure] else journey.arrivals[arrival]) ?: return null
        return stopTime.copy(place = stopTime.place.copy(track = track))
    }

    private class Call(
        var aimedDeparture: Instant? = null,
        var aimedArrival: Instant? = null,
        var departurePlatform: String? = null,
        var arrivalPlatform: String? = null,
    )

    companion object {
        /** Reads the journeys of a SIRI Lite `EstimatedTimetableDelivery`, in a stream: the feed is about 16 MB. */
        fun parse(input: InputStream): TrackIndex {
            val factory =
                XMLInputFactory.newDefaultFactory().apply {
                    setProperty(XMLInputFactory.SUPPORT_DTD, false)
                    setProperty(XMLInputFactory.IS_SUPPORTING_EXTERNAL_ENTITIES, false)
                }
            val reader = factory.createXMLStreamReader(input)
            val journeys = mutableListOf<Pair<String, Journey>>()
            var number: String? = null
            var calls = mutableListOf<Call>()
            var call: Call? = null
            try {
                while (reader.hasNext()) {
                    when (reader.next()) {
                        XMLStreamConstants.START_ELEMENT ->
                            when (reader.localName) {
                                "EstimatedVehicleJourney" -> {
                                    number = null
                                    calls = mutableListOf()
                                }
                                "TrainNumberRef" -> reader.elementText.trim().trimStart('0').let { if (number == null && it.isNotEmpty()) number = it }
                                "RecordedCall", "EstimatedCall" -> call = Call()
                                "AimedDepartureTime" -> call?.aimedDeparture = instant(reader.elementText)
                                "AimedArrivalTime" -> call?.aimedArrival = instant(reader.elementText)
                                "DeparturePlatformName" -> call?.departurePlatform = reader.elementText.trim().ifEmpty { null }
                                "ArrivalPlatformName" -> call?.arrivalPlatform = reader.elementText.trim().ifEmpty { null }
                            }
                        XMLStreamConstants.END_ELEMENT ->
                            when (reader.localName) {
                                "RecordedCall", "EstimatedCall" -> {
                                    call?.let { calls += it }
                                    call = null
                                }
                                "EstimatedVehicleJourney" ->
                                    number?.let { journeys += it to Journey(calls.byTime({ it.aimedDeparture }) { it.departurePlatform }, calls.byTime({ it.aimedArrival }) { it.arrivalPlatform }) }
                            }
                    }
                }
            } finally {
                reader.close()
            }
            return TrackIndex(journeys.groupBy({ it.first }, { it.second }))
        }

        private fun instant(text: String): Instant? = runCatching { Instant.parse(text.trim()) }.getOrNull()

        private fun List<Call>.byTime(time: (Call) -> Instant?, track: (Call) -> String?): Map<Instant, String?> =
            mapNotNull { c -> time(c)?.let { it to c } }
                .groupBy({ it.first }, { it.second })
                .mapNotNull { (t, c) -> c.singleOrNull()?.let { t to track(it) } }
                .toMap()
    }
}
