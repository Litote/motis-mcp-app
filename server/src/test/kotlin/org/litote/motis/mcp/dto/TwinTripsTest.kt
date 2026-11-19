package org.litote.motis.mcp.dto

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertSame

class TwinTripsTest {
    private fun at(hhmm: String) = "2026-11-19T$hhmm:00Z"

    /** A stop scheduled at [arrival] / [departure], its real times shifted by [delay] minutes when given. */
    private fun stop(name: String, arrival: String?, departure: String?, delay: Long? = null, track: String? = null): PlaceDto {
        fun real(t: String?) = t?.let { if (delay == null) at(it) else kotlin.time.Instant.parse(at(it)).plus(kotlin.time.Duration.parse("${delay}m")).toString() }
        return PlaceDto(name, 45.0, 5.0, arrival = real(arrival), departure = real(departure), scheduledArrival = arrival?.let(::at), scheduledDeparture = departure?.let(::at), track = track)
    }

    private fun trip(tripId: String, realTime: Boolean, vararg stops: PlaceDto): ItineraryDto {
        val leg =
            LegDto(
                mode = "HIGHSPEED_RAIL", from = stops.first(), to = stops.last(),
                startTime = stops.first().departure!!, endTime = stops.last().arrival!!,
                scheduledStartTime = stops.first().scheduledDeparture!!, scheduledEndTime = stops.last().scheduledArrival!!,
                durationSeconds = 0, realTime = realTime, tripId = tripId,
                intermediateStops = stops.toList().subList(1, stops.size - 1), polyline = Polyline(""),
            )
        return ItineraryDto(leg.startTime, leg.endTime, 0, 0, listOf(leg))
    }

    @Test
    fun `takes the real times of the twin, matched by scheduled time, the delay kept at the stops it lacks`() {
        val italian = trip("it", false, stop("LYON PART DIEU", null, "16:23"), stop("CHAMBERY", "17:40", "17:42"), stop("MODANE", "18:58", "19:00"), stop("MILANO CENTRALE", "21:07", null))
        val french = trip("fr", true, stop("Lyon-Part-Dieu", null, "16:23", 5, track = "J"), stop("St-Cassin", "17:26", "17:28", 6), stop("Chambéry", "17:40", "17:42", 8), stop("Milano Centrale", "21:07", null, 12))

        val merged = italian.withRealTimeOf(french)
        val leg = merged.legs.single()
        val stops = listOf(leg.from) + leg.intermediateStops.orEmpty() + leg.to

        assertEquals(listOf("LYON PART DIEU", "CHAMBERY", "MODANE", "MILANO CENTRALE"), stops.map { it.name })
        assertEquals(listOf(null, at("17:48"), at("19:06"), at("21:19")), stops.map { it.arrival })
        assertEquals(listOf(at("16:28"), at("17:50"), at("19:08"), null), stops.map { it.departure })
        assertEquals("J", leg.from.track)
        assertEquals(true, leg.realTime)
        assertEquals(at("16:28") to at("21:19"), merged.startTime to merged.endTime)
        assertEquals((4 * 60 + 51) * 60L, merged.durationSeconds)
    }

    @Test
    fun `keeps the times of the stops before the first one of the twin`() {
        // the Italian trip Paris → Lyon → Paris, the French one from Lyon only
        val italian = trip("it", false, stop("PARIS", null, "06:30"), stop("LYON", "08:26", "08:56"), stop("PARIS", "11:04", null))
        val french = trip("fr", true, stop("Lyon", null, "08:56", 4), stop("Paris", "11:04", null, 3))

        val leg = italian.withRealTimeOf(french).legs.single()

        assertEquals(listOf(at("06:30"), at("09:00"), null), (listOf(leg.from) + leg.intermediateStops.orEmpty() + leg.to).map { it.departure })
        assertEquals(listOf(null, at("08:30"), at("11:07")), (listOf(leg.from) + leg.intermediateStops.orEmpty() + leg.to).map { it.arrival })
    }

    @Test
    fun `a train of the twin does not leave early`() {
        val italian = trip("it", false, stop("A", null, "07:50"), stop("B", "09:46", null))
        val french = trip("fr", true, stop("A", null, "07:50", -12), stop("B", "09:46", null, -6))

        val leg = italian.withRealTimeOf(french).legs.single()

        assertEquals(at("07:50") to at("09:40"), leg.startTime to leg.endTime)
    }

    @Test
    fun `is the trip itself when it has its own real time, or the twin none`() {
        val own = trip("it", true, stop("A", null, "07:50", 2), stop("B", "09:46", null, 2))
        val noRealTime = trip("it", false, stop("A", null, "07:50"), stop("B", "09:46", null))
        val twin = trip("fr", true, stop("A", null, "07:50", 5), stop("B", "09:46", null, 5))

        assertSame(own, own.withRealTimeOf(twin))
        assertSame(noRealTime, noRealTime.withRealTimeOf(noRealTime.copy()))
    }
}
