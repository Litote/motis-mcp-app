package org.litote.motis.mcp.tools

import io.modelcontextprotocol.kotlin.sdk.server.Server
import org.litote.motis.mcp.MotisGateway
import org.litote.motis.mcp.apps.UiView
import org.litote.motis.mcp.dto.RentalsResult
import org.litote.motis.mcp.dto.toDto
import kotlin.math.roundToInt

/** Stations with vehicles listed in the summary, closest first. */
private const val NEAREST_STATIONS = 5

fun Server.addRentalTools(gateway: MotisGateway) {
    motisTool(
        name = "rentals",
        title = "Shared mobility",
        description =
            """
            Shared mobility (GBFS) in an area: bike, scooter and car sharing providers, their stations with available
            vehicles and docks, and free-floating vehicles. Shown on a map.
            """.trimIndent(),
        view = UiView.RENTALS,
        schema = {
            areaArguments()
            stringArray("providers", "Only these provider ids.")
            boolean("withVehicles", "Include free-floating vehicles (default true).")
        },
    ) { args ->
        val (title, bbox) = args.area(gateway)
        val body =
            gateway.rentals(
                bbox = bbox,
                providers = args.stringList("providers"),
                withVehicles = args.boolean("withVehicles") ?: true,
            )
        val result = body.toDto(title, bbox)
        val summary = rentalsSummary(title, result)
        ToolOutput.of(summary, RentalsResult.serializer(), result)
    }
}

/**
 * Summary for the model. Station counts are given per provider, not added up: free-floating operators report their
 * parking spots as stations, which would make a total meaningless next to docking stations.
 */
internal fun rentalsSummary(title: String, result: RentalsResult): String =
    buildString {
        appendLine("Shared mobility around $title: ${result.providers.size} provider(s).")
        result.providers.forEach { p ->
            val stations = result.stations.filter { it.providerId == p.id }
            append("- ${p.name} (id=${p.id}${p.operator?.let { ", operator $it" } ?: ""}): ${p.formFactors.joinToString(",")}")
            append(", ${p.stations} station(s) or parking spot(s)")
            if (stations.isNotEmpty()) append(" (${stations.count { it.vehiclesAvailable > 0 }} shown with vehicles)")
            append(", ${p.vehicles} free-floating vehicle(s)")
            if (p.areaVehicles > 0) append(", ${p.areaVehicles} vehicle(s) reported for its whole service area (not located)")
            appendLine()
        }
        val nearest = result.stations.filter { it.vehiclesAvailable > 0 && it.isRenting }.take(NEAREST_STATIONS)
        if (nearest.isNotEmpty()) {
            val names = result.providers.associate { it.id to it.name }
            appendLine("Nearest stations with vehicles:")
            nearest.forEach { s ->
                val distance = s.distanceKm?.let { " — ${(it * 1000).roundToInt()} m" } ?: ""
                appendLine("- ${s.name} (${names[s.providerId] ?: s.providerId}): ${s.vehiclesAvailable} vehicle(s)$distance")
            }
        }
        if (result.stations.size < result.totalStations || result.vehicles.size < result.totalVehicles) {
            appendLine("Only the closest ${result.stations.size} stations and ${result.vehicles.size} vehicles are shown on the map.")
        }
    }.trimEnd()
