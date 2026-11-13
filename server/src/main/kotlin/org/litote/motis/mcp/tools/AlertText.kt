package org.litote.motis.mcp.tools

import org.litote.motis.mcp.dto.AlertDto

/** Added to the description of the tools giving alerts. */
internal const val ALERTS_DESCRIPTION =
    "Service alerts (disruptions, works, closed lines or elevators) active at the time of a leg or departure are numbered " +
        "after it, e.g. 'alerts [1]', and listed at the end: tell the user briefly about those of the options you propose. " +
        "The itineraries do not avoid the lines with an alert: warn when one says the service is interrupted (NO_SERVICE)."

/** Longest description of an alert in the text of a tool: the views show it entirely. */
private const val MAX_TEXT_DESCRIPTION = 200

/** ` alerts [1, 2]`: the numbers of the [indexes] (positions in the alerts of the result) after a leg or departure. */
internal fun alertRefs(indexes: List<Int>?): String = indexes?.let { i -> " alerts [${i.joinToString { "${it + 1}" }}]" } ?: ""

/** The [alerts] of a result, numbered as in [alertRefs]. */
internal fun StringBuilder.appendAlerts(alerts: List<AlertDto>?) {
    if (alerts.isNullOrEmpty()) return
    appendLine("Service alerts:")
    alerts.forEachIndexed { i, alert ->
        val facts = listOfNotNull(alert.effect, alert.cause, alert.end?.let { "until $it" }).joinToString()
        val description =
            alert.description?.replace('\n', ' ')?.let { if (it.length > MAX_TEXT_DESCRIPTION) it.take(MAX_TEXT_DESCRIPTION - 1).trimEnd() + "…" else it }
        appendLine("[${i + 1}] ${alert.header}${facts.takeIf { it.isNotEmpty() }?.let { " ($it)" } ?: ""}${description?.let { ": $it" } ?: ""}")
    }
}
