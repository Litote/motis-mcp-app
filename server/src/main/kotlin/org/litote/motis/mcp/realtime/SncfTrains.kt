package org.litote.motis.mcp.realtime

/**
 * Trains of the SNCF in Transitous and in the open data feeds of the SNCF: Transitous imports the timetable of the SNCF
 * from its NeTEx export, its trip ids are not those of the feeds. A trip is matched by its train number.
 */
internal object SncfTrains {
    /**
     * Trip of the SNCF in Transitous, of the `fr-horaires-sncf` feed or of a regional one: its NeTEx id is a service
     * journey of the SNCF, e.g. `<date>_<time>_fr-horaires-sncf_FR:ServiceJourney::SN6823FERRE_…` or
     * `<date>_<time>_fr-trains-express-regionaux-zou-…_SNC:FR:ServiceJourney::SN17703FERRE_…`.
     */
    private val TRANSITOUS_TRIP = Regex("""ServiceJourney::SN\d""")

    /** `OCE` + 2 letters (SN: train, SA, EA, LO: TER and coaches) + train number, e.g. `OCESN5537F…`. */
    private val FEED_TRIP = Regex("""^OCE[A-Z]{2}0*(\d+)""")

    fun isSncfTrip(tripId: String?): Boolean = tripId != null && TRANSITOUS_TRIP.containsMatchIn(tripId)

    /** Train number of a trip of Transitous, from its short name, without leading zeros; null when not a number. */
    fun number(tripShortName: String?): String? = tripShortName?.trimStart('0')?.takeIf { it.isNotEmpty() && it.all(Char::isDigit) }

    /** Train number of a trip of the feeds of the SNCF, from its trip id; null when not an SNCF train. */
    fun feedNumber(feedTripId: String): String? = FEED_TRIP.find(feedTripId)?.groupValues?.get(1)
}
