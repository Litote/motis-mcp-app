package org.litote.motis.mcp.realtime

import org.litote.motis.client.model.Itinerary
import org.litote.motis.client.model.StopTime

/**
 * Service alerts of another source added to those of the results of MOTIS (stop times, trips and journeys), when MOTIS
 * has none for them. They are then filtered and mapped as the others (see [org.litote.motis.mcp.dto.activeAlerts]).
 */
interface AlertSource {
    /** [stopTimes] with the alerts of the source added to those of their place. Never fails: unchanged instead. */
    suspend fun addToStopTimes(stopTimes: List<StopTime>, language: List<String>?): List<StopTime>

    /** [itineraries] with the alerts of the source added to those of their legs. Never fails: unchanged instead. */
    suspend fun addToItineraries(itineraries: List<Itinerary>, language: List<String>?): List<Itinerary>
}
