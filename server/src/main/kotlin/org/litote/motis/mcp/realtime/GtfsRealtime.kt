@file:OptIn(ExperimentalSerializationApi::class)

package org.litote.motis.mcp.realtime

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.protobuf.ProtoNumber

/*
 * Subset of the GTFS Realtime trip updates (https://gtfs.org/realtime/proto/): the other fields are skipped when decoded.
 * The enums are kept as numbers, a value added to the specification must not fail the decoding. The signed fields are
 * read as Long: a negative int32 is encoded on 64 bits.
 */

@Serializable
internal data class FeedMessage(
    @ProtoNumber(1) val header: FeedHeader = FeedHeader(),
    @ProtoNumber(2) val entity: List<FeedEntity> = emptyList(),
)

@Serializable
internal data class FeedHeader(
    @ProtoNumber(1) val gtfsRealtimeVersion: String = "2.0",
    /** Seconds since the epoch. */
    @ProtoNumber(3) val timestamp: Long = 0,
)

@Serializable
internal data class FeedEntity(
    @ProtoNumber(1) val id: String = "",
    @ProtoNumber(3) val tripUpdate: TripUpdate? = null,
)

@Serializable
internal data class TripUpdate(
    @ProtoNumber(1) val trip: TripDescriptor = TripDescriptor(),
    @ProtoNumber(2) val stopTimeUpdate: List<StopTimeUpdate> = emptyList(),
)

@Serializable
internal data class TripDescriptor(
    @ProtoNumber(1) val tripId: String = "",
    /** Service date, `YYYYMMDD`. */
    @ProtoNumber(3) val startDate: String = "",
    @ProtoNumber(4) val scheduleRelationship: Int = SCHEDULED,
) {
    companion object {
        const val SCHEDULED = 0
        const val CANCELED = 3
    }
}

@Serializable
internal data class StopTimeUpdate(
    @ProtoNumber(2) val arrival: StopTimeEvent? = null,
    @ProtoNumber(3) val departure: StopTimeEvent? = null,
    @ProtoNumber(4) val stopId: String = "",
    @ProtoNumber(5) val scheduleRelationship: Int = SCHEDULED,
) {
    companion object {
        const val SCHEDULED = 0
        const val SKIPPED = 1
    }
}

/** [time] estimated, in seconds since the epoch (0: not given), [delay] in seconds from the scheduled time. */
@Serializable
internal data class StopTimeEvent(
    @ProtoNumber(1) val delay: Long = 0,
    @ProtoNumber(2) val time: Long = 0,
)
