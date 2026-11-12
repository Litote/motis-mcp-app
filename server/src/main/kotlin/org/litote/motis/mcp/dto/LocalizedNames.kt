package org.litote.motis.mcp.dto

/**
 * Names of the stations of a result in [language] (see [StationNames]): the places with coordinates are matched with
 * the station nearby, the other names (headsigns, next stops...) by their city. The places that are not stops (the
 * coordinates or the addresses asked by the user) are kept.
 */
class LocalizedNames(private val language: String, private val stations: StationNames = StationNames.default) {
    private fun name(name: String) = stations.localize(name, null, null, language)

    fun place(place: PlaceDto): PlaceDto =
        if (place.stopId == null) place else place.copy(name = stations.localize(place.name, place.lat, place.lon, language))

    fun match(match: PlaceMatchDto): PlaceMatchDto =
        if (match.type == "STOP") match.copy(name = stations.localize(match.name, match.lat, match.lon, language)) else match

    private fun stopTime(stopTime: StopTimeDto) =
        stopTime.copy(headsign = name(stopTime.headsign), stops = stopTime.stops?.map { it.copy(name = name(it.name)) })

    private fun leg(leg: LegDto) =
        leg.copy(from = place(leg.from), to = place(leg.to), headsign = leg.headsign?.let(::name), intermediateStops = leg.intermediateStops?.map(::place))

    private fun stop(stop: ItineraryStop) = stop.copy(name = name(stop.name))

    fun itinerary(itinerary: ItineraryDto) =
        itinerary.copy(
            legs = itinerary.legs.map(::leg),
            departure = itinerary.departure?.let(::stop),
            arrival = itinerary.arrival?.let(::stop),
            transferStops = itinerary.transferStops?.map(::name),
        )

    fun search(result: SearchResult) = result.copy(matches = result.matches.map(::match))

    fun departures(result: DeparturesResult) = result.copy(stop = place(result.stop), stopTimes = result.stopTimes.map(::stopTime))

    fun trip(result: TripResult) = result.copy(itinerary = itinerary(result.itinerary))

    fun journey(result: JourneyResult) =
        result.copy(
            from = place(result.from),
            to = place(result.to),
            itineraries = result.itineraries.map(::itinerary),
            direct = result.direct.map(::itinerary),
        )

    companion object {
        /** The names of a result in the first language of [languages] with names of stations, else null (unchanged names). */
        fun of(languages: List<String>?): LocalizedNames? = languages.stationLanguage()?.let(::LocalizedNames)
    }
}
