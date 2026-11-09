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

    private fun rerALengthKm(repairShapes: Boolean): Double =
        runBlocking {
            val motis = MockMotis { respondJson(plan) }
            val config = MotisMcpConfig(contact = "https://example.org/tests")
            val gateway = MotisGateway(config.clientConfiguration(motis.engine), repairShapes = repairShapes)
            val leg = gateway.plan(query).itineraries.single().legs.single { it.tripId != null }
            val points = PolylineCodec.decode(leg.legGeometry.points, leg.legGeometry.precision.toInt())
            assertEquals(points.size.toLong(), leg.legGeometry.length)
            points.zipWithNext { a, b -> distanceKm(a.first, a.second, b.first, b.second) }.sum()
        }

    @Test
    fun `repairs the shapes of the journeys by default`() {
        assertTrue(rerALengthKm(repairShapes = true) < 14)
    }

    @Test
    fun `keeps the shapes of MOTIS when disabled`() {
        assertTrue(rerALengthKm(repairShapes = false) > 20)
    }
}
