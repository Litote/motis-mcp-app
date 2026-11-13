package org.litote.motis.mcp.dto

import kotlinx.serialization.json.Json
import org.litote.motis.client.client.RoutingClient
import org.litote.motis.client.client.TimetableClient
import org.litote.motis.client.model.Alert
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Instant

class AlertsTest {
    private val json = Json { ignoreUnknownKeys = true }

    /** MOTIS always gives a header and a description, maybe empty. */
    private fun alert(fields: String): Alert =
        json.decodeFromString(Alert.serializer(), if ("descriptionText" in fields) "{$fields}" else """{"descriptionText": "", $fields}""")

    private fun period(start: String, end: String) = """[{"start": "$start", "end": "$end"}]"""

    private val at = Instant.parse("2026-11-13T10:25:00Z")
    private val until = Instant.parse("2026-11-13T10:50:00Z")

    @Test
    fun `the HTML of the descriptions becomes plain text`() {
        val text =
            plainText(
                "<p>Le trafic est perturb&#233; de Marne-la-Vall&#233;e Chessy vers Poissy.<br><br>Pour plus d'informations, " +
                    "consultez le <a href=\"https://twitter.com/RER_A\">fil X du RER A</a>&nbsp;&amp; le site.</p>",
            )

        assertEquals(
            "Le trafic est perturbé de Marne-la-Vallée Chessy vers Poissy.\nPour plus d'informations, consultez le fil X du RER A & le site.",
            text,
        )
        assertEquals("", plainText(null))
        assertEquals("&unknown; A", plainText("&unknown; &#x41;"))
    }

    @Test
    fun `an alert is active when one of its impact periods overlaps the leg`() {
        val now = alert(""""headerText": "RER A", "impactPeriod": ${period("2026-11-13T09:51:00Z", "2026-11-13T11:00:00Z")}""")
        val later = alert(""""headerText": "RER C", "impactPeriod": ${period("2026-11-16T22:00:00Z", "2026-11-20T04:00:00Z")}""")
        val ended = alert(""""headerText": "RER B", "impactPeriod": ${period("2026-11-12T09:00:00Z", "2026-11-13T10:00:00Z")}""")

        assertTrue(now.isActive(at, until))
        assertFalse(later.isActive(at, until))
        assertFalse(ended.isActive(at, until))
    }

    @Test
    fun `an alert without end, without period or with only communication periods is kept as long as it applies`() {
        val noEnd = alert(""""headerText": "Ascensor", "impactPeriod": ${period("2026-11-08T06:38:00Z", "1970-01-01T00:00:00Z")}""")
        val noPeriod = alert(""""headerText": "Info"""")
        val communication = alert(""""headerText": "Info", "communicationPeriod": ${period("2026-11-14T00:00:00Z", "2026-11-15T00:00:00Z")}""")

        assertTrue(noEnd.isActive(at, until))
        assertNull(noEnd.toDto()?.end)
        assertTrue(noPeriod.isActive(at, until))
        assertFalse(communication.isActive(at, until))
    }

    @Test
    fun `the header of an alert without one is the first sentence of its description`() {
        val dto =
            alert(
                """"headerText": "", "descriptionText": "Ascensor fuera de servicio. Como alternativa, puede utilizarse el otro ascensor.",
                   "effect": "UNKNOWN_EFFECT", "cause": "UNKNOWN_CAUSE", "url": "javascript:alert(1)"""",
            ).toDto()!!

        assertEquals("Ascensor fuera de servicio.", dto.header)
        assertEquals("Ascensor fuera de servicio. Como alternativa, puede utilizarse el otro ascensor.", dto.description)
        assertNull(dto.effect)
        assertNull(dto.cause)
        assertNull(dto.url)
        assertNull(alert(""""headerText": " ", "descriptionText": "<p></p>"""").toDto())
        assertEquals("Train supprimé.", alert(""""headerText": "Plus d'information :", "descriptionText": "<p>Train supprimé. Reportez-vous au suivant.</p>"""").toDto()?.header)
    }

    @Test
    fun `a long header is cut, and given entirely as description`() {
        val text = "Bus 18 en 21 rijden om vanaf halte Haarlemmerplein. Details: gvb.nl -- Bus 18 and 21 run a diverted route from Haarlemmerplein. Details: gvb.nl"
        val dto = alert(""""headerText": "$text"""").toDto()!!

        assertEquals(140, dto.header.length)
        assertTrue(dto.header.endsWith("…"))
        assertEquals(text, dto.description)
    }

    @Test
    fun `the effect, the cause, the link and the end of the impact are kept`() {
        val dto =
            alert(
                """"headerText": "RER A : perturbations", "descriptionText": "RER A : perturbations", "effect": "REDUCED_SERVICE",
                   "cause": "TECHNICAL_PROBLEM", "url": "https://www.ratp.fr", "impactPeriod": ${period("2026-11-13T09:51:00Z", "2026-11-13T11:00:00Z")}""",
            ).toDto()!!

        assertEquals(AlertDto("RER A : perturbations", null, "https://www.ratp.fr", "REDUCED_SERVICE", "TECHNICAL_PROBLEM", "2026-11-13T11:00:00Z"), dto)
    }

    @Test
    fun `the active alerts of a leg are those of its line and of its ends, without duplicates`() {
        val leg =
            json.decodeFromString<RoutingClient.PlanResponseBody>(javaClass.getResource("/motis/plan.json")!!.readText())
                .itineraries.flatMap { it.legs }.first { it.tripId != null }
        val active = alert(""""headerText": "Perturbations"""")
        val elevator = alert(""""headerText": "Ascenseur hors service"""")
        val future = alert(""""headerText": "Travaux", "impactPeriod": ${period("2099-01-01T00:00:00Z", "2099-01-02T00:00:00Z")}""")

        val dto = leg.copy(alerts = listOf(active, future, active), to = leg.to.copy(alerts = listOf(elevator))).toDto()

        assertEquals(listOf("Perturbations", "Ascenseur hors service"), dto.pendingAlerts.map { it.header })
    }

    @Test
    fun `the alerts of a result are in a table referenced by the legs`() {
        val plan = json.decodeFromString<RoutingClient.PlanResponseBody>(javaClass.getResource("/motis/plan.json")!!.readText())
        val a = AlertDto("A")
        val b = AlertDto("B")
        val journey = plan.toDto()
        val withPending =
            journey.copy(
                itineraries =
                    journey.itineraries.mapIndexed { i, it ->
                        it.copy(legs = it.legs.mapIndexed { j, leg -> if (j == 0) leg.copy(pendingAlerts = if (i == 0) listOf(a) else listOf(b, a)) else leg })
                    },
            )

        val result = withPending.withAlerts()

        assertEquals(listOf(a, b), result.alerts)
        assertEquals(listOf(0), result.itineraries[0].legs[0].alerts)
        assertEquals(listOf(1, 0), result.itineraries[1].legs[0].alerts)
        assertNull(result.itineraries[0].legs.getOrNull(1)?.alerts)
        assertNull(journey.withAlerts().alerts)
        // not sent: only the table and the indexes are
        assertFalse(dtoJsonString(result).contains("pendingAlerts"))
    }

    @Test
    fun `the alerts of a stop time are those active at its time`() {
        val stopTime =
            json.decodeFromString<TimetableClient.StoptimesResponseBody>(javaClass.getResource("/motis/stoptimes.json")!!.readText()).stopTimes.first()
        val departure = requireNotNull(stopTime.place.departure ?: stopTime.place.scheduledDeparture)
        val before = alert(""""headerText": "Avant", "impactPeriod": ${period("2020-01-01T00:00:00Z", departure.minus(kotlin.time.Duration.parse("1m")).toString())}""")
        val during = alert(""""headerText": "Pendant", "impactPeriod": ${period("2020-01-01T00:00:00Z", "2099-01-01T00:00:00Z")}""")

        val dto = stopTime.copy(place = stopTime.place.copy(alerts = listOf(before, during))).toDto(arriveBy = false)

        assertEquals(listOf("Pendant"), dto.pendingAlerts.map { it.header })
    }

    private fun dtoJsonString(result: JourneyResult): String = Json.encodeToString(JourneyResult.serializer(), result)
}
