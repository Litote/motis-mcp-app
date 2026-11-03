package org.litote.motis.mcp.cities

import aws.sdk.kotlin.services.dynamodb.DynamoDbClient
import aws.sdk.kotlin.services.dynamodb.createTable
import aws.sdk.kotlin.services.dynamodb.getItem
import aws.sdk.kotlin.services.dynamodb.model.AttributeDefinition
import aws.sdk.kotlin.services.dynamodb.model.AttributeValue
import aws.sdk.kotlin.services.dynamodb.model.BillingMode
import aws.sdk.kotlin.services.dynamodb.model.KeySchemaElement
import aws.sdk.kotlin.services.dynamodb.model.KeyType
import aws.sdk.kotlin.services.dynamodb.model.ResourceInUseException
import aws.sdk.kotlin.services.dynamodb.model.ScalarAttributeType
import aws.sdk.kotlin.runtime.auth.credentials.StaticCredentialsProvider
import aws.smithy.kotlin.runtime.auth.awscredentials.Credentials
import aws.smithy.kotlin.runtime.net.url.Url
import kotlinx.coroutines.runBlocking
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * Against DynamoDB Local, when `DYNAMODB_LOCAL_ENDPOINT` is set (e.g. `docker run -p 8000:8000 amazon/dynamodb-local`
 * and `DYNAMODB_LOCAL_ENDPOINT=http://localhost:8000`): skipped otherwise.
 */
class DynamoDbCityStationsStoreTest {
    private val endpoint: String? = System.getenv("DYNAMODB_LOCAL_ENDPOINT")?.takeIf { it.isNotBlank() }

    private fun withStore(block: suspend (DynamoDbCityStationsStore, DynamoDbClient) -> Unit) {
        val endpoint = endpoint ?: return
        runBlocking {
            DynamoDbClient {
                region = "eu-west-3"
                endpointUrl = Url.parse(endpoint)
                credentialsProvider = StaticCredentialsProvider(Credentials("local", "local"))
            }.use { client ->
                try {
                    client.createTable {
                        tableName = TABLE
                        billingMode = BillingMode.PayPerRequest
                        attributeDefinitions = listOf(AttributeDefinition { attributeName = "pair"; attributeType = ScalarAttributeType.S })
                        keySchema = listOf(KeySchemaElement { attributeName = "pair"; keyType = KeyType.Hash })
                    }
                } catch (_: ResourceInUseException) {
                    // created by a previous run
                }
                block(DynamoDbCityStationsStore(client, TABLE), client)
            }
        }
    }

    @Test
    fun `the stations of a pair of cities are saved and read`() =
        withStore { store, client ->
            val key = "paris>nantes-${System.nanoTime()}"
            val stations = CityStations(listOf("montparnasse", "massy"), listOf("nantes"), Instant.ofEpochSecond(1_800_000_000))

            assertNull(store.get(key))
            store.put(key, stations)

            assertEquals(stations, store.get(key))
            // deleted by the TTL of the table 30 days later
            val item = client.getItem { tableName = TABLE; this.key = mapOf("pair" to AttributeValue.S(key)) }.item!!
            assertEquals("${1_800_000_000 + 30 * 86_400}", item.getValue("expiresAt").asN())
        }

    @Test
    fun `cities without long-distance train are saved without stations`() =
        withStore { store, _ ->
            val key = "paris>versailles-${System.nanoTime()}"
            val stations = CityStations(emptyList(), emptyList(), Instant.ofEpochSecond(1_800_000_000))

            store.put(key, stations)

            assertEquals(stations, store.get(key))
        }

    private companion object {
        const val TABLE = "city-stations-test"
    }
}
