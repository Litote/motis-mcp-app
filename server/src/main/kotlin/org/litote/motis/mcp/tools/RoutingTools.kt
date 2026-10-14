package org.litote.motis.mcp.tools

import io.modelcontextprotocol.kotlin.sdk.server.Server
import org.litote.motis.mcp.MotisGateway
import org.litote.motis.mcp.PlanQuery
import org.litote.motis.mcp.apps.UiView
import org.litote.motis.mcp.dto.JourneyResult
import org.litote.motis.mcp.dto.toDto

fun Server.addRoutingTools(gateway: MotisGateway) {
    motisTool(
        name = "plan_journey",
        title = "Plan a journey",
        description =
            """
            Computes public transport itineraries between two places (names, stop ids or 'lat,lon'),
            with walking legs, transfers and real-time data. Shows them as a list and on a map.
            """.trimIndent(),
        view = UiView.ITINERARY,
        schema = {
            string("from", "Origin: place name, stop id or 'lat,lon'.", required = true)
            string("to", "Destination: place name, stop id or 'lat,lon'.", required = true)
            string("time", "Departure (or arrival with arriveBy) date-time, ISO-8601 with offset. Default: now.")
            boolean("arriveBy", "true: 'time' is the latest arrival time.")
            stringArray("modes", "Allowed transit modes (default: all).", TRANSIT_MODES)
            integer("maxTransfers", "Maximum number of transfers.", minimum = 0, maximum = 10)
            integer(
                "maxWalkMinutes",
                "Maximum walk to the first stop and from the last stop, in minutes " +
                    "(default ${MotisGateway.DEFAULT_MAX_WALK_MINUTES}): lower for a user who walks little.",
                minimum = 1,
                maximum = 60,
            )
            integer("count", "Minimum number of itineraries (default 5).", minimum = 1, maximum = 20)
            string("pageCursor", "Cursor returned by a previous call, for earlier or later itineraries.")
            string("language", LANGUAGE_DESCRIPTION)
        },
    ) { args ->
        val pageCursor = args.string("pageCursor")
        val from = gateway.resolvePlace(args.requireString("from"))
        val to = gateway.resolvePlace(args.requireString("to"))
        val result =
            gateway
                .plan(
                    PlanQuery(
                        from = from.id,
                        to = to.id,
                        time = args.instant("time"),
                        arriveBy = args.boolean("arriveBy") ?: false,
                        transitModes = args.modes("modes"),
                        maxTransfers = args.int("maxTransfers"),
                        maxWalkMinutes = args.int("maxWalkMinutes") ?: MotisGateway.DEFAULT_MAX_WALK_MINUTES,
                        numItineraries = args.int("count"),
                        pageCursor = pageCursor,
                        language = args.stringList("language"),
                    ),
                ).toDto()
        val summary =
            buildString {
                appendLine("From ${from.name} to ${to.name}: ${result.itineraries.size} itinerary(ies).")
                result.itineraries.forEachIndexed { i, it -> appendLine("${i + 1}. ${it.describe()}") }
                result.direct.firstOrNull()?.let { appendLine("Direct (without transit): ${it.describe()}") }
            }.trimEnd()
        ToolOutput.of(summary, JourneyResult.serializer(), result)
    }
}
