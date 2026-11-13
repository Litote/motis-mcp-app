package org.litote.motis.mcp.dto

import org.litote.motis.client.model.Alert
import org.litote.motis.client.model.AlertCause
import org.litote.motis.client.model.AlertEffect
import org.litote.motis.client.model.TimeRange
import kotlin.time.Instant

/**
 * Alerts kept for a leg or a stop time: the feeds attach every alert of a line to its trips (27 on a RER C leg, none
 * active at its time), only those active during the leg are kept.
 */
const val MAX_ALERTS = 5

/** Alerts of a result (table referenced by the legs and stop times). */
const val MAX_RESULT_ALERTS = 30

/** Longest header and description of an alert. */
private const val MAX_HEADER_CHARS = 140
private const val MAX_DESCRIPTION_CHARS = 800

/** Effects and causes telling nothing. */
private val UNKNOWN_EFFECTS = setOf(AlertEffect.UNKNOWN_EFFECT, AlertEffect.OTHER_EFFECT, AlertEffect.UNKNOWN_)
private val UNKNOWN_CAUSES = setOf(AlertCause.UNKNOWN_CAUSE, AlertCause.OTHER_CAUSE, AlertCause.UNKNOWN_)

/**
 * Alerts active between [from] and [to] (the times of a leg, or the time of a stop time), as DTOs without duplicates,
 * at most [MAX_ALERTS].
 */
fun List<Alert>?.activeAlerts(from: Instant, to: Instant = from): List<AlertDto> =
    orEmpty()
        .filter { it.isActive(from, to) }
        .mapNotNull { it.toDto() }
        .distinctBy { it.header to it.description }
        .take(MAX_ALERTS)

/**
 * True when the alert applies between [from] and [to]: one of its impact periods (or, without them, of its communication
 * periods) overlaps them; always without period.
 */
internal fun Alert.isActive(from: Instant, to: Instant): Boolean {
    val periods = impactPeriod?.ifEmpty { null } ?: communicationPeriod?.ifEmpty { null } ?: return true
    return periods.any { range -> range.start <= to && (range.openEnd() ?: Instant.DISTANT_FUTURE) >= from }
}

/** End of a period, null when open: the feeds without end give 0 (1970-01-01). */
private fun TimeRange.openEnd(): Instant? = end.takeIf { it > Instant.fromEpochSeconds(0) && it >= start }

/** End of the impact of the alert, null when open or unknown. */
private fun Alert.impactEnd(): Instant? {
    val ends = impactPeriod.orEmpty().map { it.openEnd() }
    return if (ends.isEmpty() || ends.any { it == null }) null else ends.filterNotNull().max()
}

/** The alert without its HTML, null without text. A missing header is the start of the description. */
internal fun Alert.toDto(): AlertDto? {
    // a header introducing the description tells nothing ("Plus d'information :" of the SNCF)
    val fullHeader = plainText(headerText).takeUnless { it.isBlank() || it.endsWith(":") }
    val description = plainText(descriptionText).ifBlank { null }
    val header = (fullHeader ?: description?.let(::firstSentence) ?: return null).truncated(MAX_HEADER_CHARS)
    return AlertDto(
        header = header,
        // a long header cut is given entirely as description
        description = (description ?: fullHeader)?.takeUnless { it == header }?.truncated(MAX_DESCRIPTION_CHARS),
        url = url?.trim()?.takeIf { it.startsWith("https://") || it.startsWith("http://") },
        effect = effect?.takeUnless { it in UNKNOWN_EFFECTS }?.serialName(),
        cause = cause?.takeUnless { it in UNKNOWN_CAUSES }?.serialName(),
        end = impactEnd()?.toString(),
    )
}

private fun firstSentence(text: String): String = text.substringBefore('\n').let { line -> SENTENCE_END.find(line)?.let { line.substring(0, it.range.first + 1) } ?: line }

private val SENTENCE_END = Regex("""[.!?](\s|$)""")

private fun String.truncated(max: Int): String = if (length <= max) this else take(max - 1).trimEnd() + "…"

private val BLOCK_TAG = Regex("""<\s*(br|/p|/div|/li|/h\d)\b[^>]*>""", RegexOption.IGNORE_CASE)
private val TAG = Regex("""<[^>]*>""")
private val ENTITY = Regex("""&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z]+);""")
private val SPACES = Regex("""[ \t ]+""")
private val BLANK_LINES = Regex("""\s*\n\s*""")

private val NAMED_ENTITIES =
    mapOf(
        "amp" to "&", "lt" to "<", "gt" to ">", "quot" to "\"", "apos" to "'", "nbsp" to " ", "laquo" to "«", "raquo" to "»",
        "rsquo" to "’", "lsquo" to "‘", "rdquo" to "”", "ldquo" to "“", "hellip" to "…", "ndash" to "–", "mdash" to "—",
        "euro" to "€", "eacute" to "é", "egrave" to "è", "ecirc" to "ê", "agrave" to "à", "acirc" to "â", "ccedil" to "ç",
        "ocirc" to "ô", "ucirc" to "û", "ugrave" to "ù", "icirc" to "î", "iuml" to "ï", "euml" to "ë", "Eacute" to "É",
    )

/**
 * Text of an alert without its HTML (the feeds of Île-de-France and of the SNCF send HTML): tags removed, the line breaks
 * kept, entities decoded, spaces collapsed.
 */
internal fun plainText(html: String?): String {
    if (html.isNullOrBlank()) return ""
    val text = TAG.replace(BLOCK_TAG.replace(html, "\n"), "")
    return ENTITY.replace(text) { m ->
        val entity = m.groupValues[1]
        when {
            entity.startsWith("#x") || entity.startsWith("#X") -> entity.drop(2).toIntOrNull(16)?.let(::codePoint)
            entity.startsWith("#") -> entity.drop(1).toIntOrNull()?.let(::codePoint)
            else -> NAMED_ENTITIES[entity]
        } ?: m.value
    }.replace(SPACES, " ").replace(BLANK_LINES, "\n").trim()
}

private fun codePoint(value: Int): String? = runCatching { String(Character.toChars(value)) }.getOrNull()

/**
 * Replaces the alerts of the legs or stop times by their index in a table of the result: the same alert is on many of
 * them (each departure of a line, each itinerary taking it).
 */
class AlertTable {
    private val alerts = mutableListOf<AlertDto>()

    /** Indexes of the [pending] alerts, null without them. */
    fun indexes(pending: List<AlertDto>): List<Int>? =
        pending.mapNotNull { alert ->
            alerts.indexOf(alert).takeIf { it >= 0 }
                ?: alerts.size.takeIf { it < MAX_RESULT_ALERTS }?.also { alerts += alert }
        }.ifEmpty { null }

    /** The table, null when empty. */
    fun alerts(): List<AlertDto>? = alerts.toList().ifEmpty { null }
}

private fun ItineraryDto.withAlerts(table: AlertTable): ItineraryDto =
    copy(legs = legs.map { it.copy(alerts = table.indexes(it.pendingAlerts)) })

/** The alerts of the legs, in the table of the result. */
fun JourneyResult.withAlerts(): JourneyResult {
    val table = AlertTable()
    // the itineraries first: their alerts get the first indexes
    val itineraries = itineraries.map { it.withAlerts(table) }
    val direct = direct.map { it.withAlerts(table) }
    return copy(itineraries = itineraries, direct = direct, alerts = table.alerts())
}

/** The alerts of the legs of the trip, in the table of the result. */
fun TripResult.withAlerts(): TripResult {
    val table = AlertTable()
    return copy(itinerary = itinerary.withAlerts(table), alerts = table.alerts())
}

/** The alerts of the stop times, in the table of the result. */
fun DeparturesResult.withAlerts(): DeparturesResult {
    val table = AlertTable()
    return copy(stopTimes = stopTimes.map { it.copy(alerts = table.indexes(it.pendingAlerts)) }, alerts = table.alerts())
}
