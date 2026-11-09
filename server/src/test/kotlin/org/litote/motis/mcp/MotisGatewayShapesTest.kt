package org.litote.motis.mcp

import kotlinx.coroutines.runBlocking
import org.litote.motis.mcp.dto.PolylineCodec
import org.litote.motis.mcp.dto.distanceKm
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class MotisGatewayShapesTest {
    // journey of Transitous (November 2026): its RER A from Gare de Lyon to La Défense goes around Paris by the north
    private val plan = javaClass.getResource("/motis/plan-rer-a-detour.json")!!.readText()
    private val query = PlanQuery(from = "48.8443,2.3744", to = "48.8924,2.2378")
    private val logs = mutableListOf<String>()

    private fun gateway(repairShapes: Boolean): MotisGateway {
        val motis = MockMotis { respondJson(plan) }
        val config = MotisMcpConfig(contact = "https://example.org/tests")
        return MotisGateway(config.clientConfiguration(motis.engine), repairShapes = repairShapes, logShapeRepair = { logs += it })
    }

    private fun MotisGateway.rerALengthKm(): Double =
        runBlocking {
            val leg = plan(query).itineraries.single().legs.single { it.tripId != null }
            val points = PolylineCodec.decode(leg.legGeometry.points, leg.legGeometry.precision.toInt())
            assertEquals(points.size.toLong(), leg.legGeometry.length)
            points.zipWithNext { a, b -> distanceKm(a.first, a.second, b.first, b.second) }.sum()
        }

    @Test
    fun `repairs the shapes of the journeys by default, logging each part once`() {
        val gateway = gateway(repairShapes = true)
        assertTrue(gateway.rerALengthKm() < 14)
        gateway.rerALengthKm()

        val log = logs.single()
        assertEquals(
            "Shape repaired: A (fr-reseau-urbain-et-interurbain-dile-de-france-mobilites_IDFM:C01742) " +
                "Châtelet - Les Halles -> Auber: 14.2 km drawn for 1.7 km, " +
                "trip 20261109_19:21_fr-reseau-urbain-et-interurbain-dile-de-france-mobilites_IDFM:TN:SNCF:1e082ea3-ac84-45a8-9632-f365bbce22e3",
            log,
        )
    }

    @Test
    fun `keeps the shapes of MOTIS when disabled`() {
        assertTrue(gateway(repairShapes = false).rerALengthKm() > 20)
        assertEquals(emptyList(), logs)
    }
}
