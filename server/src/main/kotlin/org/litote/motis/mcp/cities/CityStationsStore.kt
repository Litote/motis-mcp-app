package org.litote.motis.mcp.cities

import aws.sdk.kotlin.services.dynamodb.DynamoDbClient
import aws.sdk.kotlin.services.dynamodb.model.AttributeValue
import aws.sdk.kotlin.services.dynamodb.getItem
import aws.sdk.kotlin.services.dynamodb.putItem
import java.time.Instant
import kotlin.time.Duration
import kotlin.time.Duration.Companion.days

/**
 * Stop ids of the stations of the journeys between two cities, most used first: [from] in the city of departure, [to]
 * in the city of arrival (e.g. Paris Montparnasse and Massy TGV, then Nantes). Empty when no long-distance train links
 * them (e.g. Paris and Versailles). [discoveredAt]: when they were found from the journeys between the city centers.
 */
data class CityStations(val from: List<String>, val to: List<String>, val discoveredAt: Instant)

/** Stations of the journeys between two cities, by key of the pair of cities (see [CityJourneys]). */
interface CityStationsStore {
    suspend fun get(key: String): CityStations?

    suspend fun put(key: String, stations: CityStations)
}

/** Stations kept by the process (or the warm Lambda instance): at most [maxSize] pairs, the least recently used evicted. */
class InMemoryCityStationsStore(private val maxSize: Int = 1000) : CityStationsStore {
    private val entries =
        object : LinkedHashMap<String, CityStations>(16, 0.75f, true) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, CityStations>): Boolean = size > maxSize
        }

    override suspend fun get(key: String): CityStations? = synchronized(entries) { entries[key] }

    override suspend fun put(key: String, stations: CityStations) {
        synchronized(entries) { entries[key] = stations }
    }
}

/**
 * Stations kept in the DynamoDB table [table] (partition key `pair`, string), shared by the Lambda instances. The
 * pairs not discovered again for [retention] are deleted by the TTL of the table (attribute `expiresAt`).
 */
class DynamoDbCityStationsStore(
    private val client: DynamoDbClient,
    private val table: String,
    private val retention: Duration = 30.days,
) : CityStationsStore {
    override suspend fun get(key: String): CityStations? =
        client
            .getItem {
                tableName = table
                this.key = mapOf(PAIR to AttributeValue.S(key))
            }.item
            ?.let { item ->
                CityStations(
                    from = item.stopIds(FROM),
                    to = item.stopIds(TO),
                    discoveredAt = Instant.ofEpochSecond(item.getValue(DISCOVERED_AT).asN().toLong()),
                )
            }

    override suspend fun put(key: String, stations: CityStations) {
        client.putItem {
            tableName = table
            item =
                mapOf(
                    PAIR to AttributeValue.S(key),
                    FROM to AttributeValue.L(stations.from.map { AttributeValue.S(it) }),
                    TO to AttributeValue.L(stations.to.map { AttributeValue.S(it) }),
                    DISCOVERED_AT to AttributeValue.N(stations.discoveredAt.epochSecond.toString()),
                    EXPIRES_AT to AttributeValue.N((stations.discoveredAt.epochSecond + retention.inWholeSeconds).toString()),
                )
        }
    }

    private fun Map<String, AttributeValue>.stopIds(name: String): List<String> = get(name)?.asL()?.map { it.asS() }.orEmpty()

    companion object {
        private const val PAIR = "pair"
        private const val FROM = "from"
        private const val TO = "to"
        private const val DISCOVERED_AT = "discoveredAt"
        private const val EXPIRES_AT = "expiresAt"

        /** Client of the AWS [region], with the default credentials (environment variables on Lambda, else profile). */
        fun create(table: String, region: String): DynamoDbCityStationsStore =
            DynamoDbCityStationsStore(DynamoDbClient { this.region = region }, table)
    }
}
