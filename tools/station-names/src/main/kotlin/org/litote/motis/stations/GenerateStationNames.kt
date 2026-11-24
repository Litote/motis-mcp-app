/**
 * Generates server/src/main/resources/stations/stations.tsv: the railway stations with their name in each language.
 *
 * Sources:
 *  * Trainline stations (https://github.com/trainline-eu/stations, ODbL): UIC code, coordinates and local name;
 *  * Wikidata (CC0): labels of the municipality of the station (P722 = UIC code, P131 = located in), used to translate the
 *    city part of the name ("Girona" -> "Gérone", "Barcelona Sants" -> "Barcelone Sants").
 *
 * Usage: `./gradlew :tools:station-names:run [-Pcsv=stations.csv]` (downloaded when no file is given).
 * The result is derived from Trainline data: it is published under the ODbL (see server/src/main/resources/stations/README.md).
 */
package org.litote.motis.stations

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.math.BigDecimal
import java.math.RoundingMode
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.text.Normalizer
import java.time.Duration
import kotlin.system.exitProcess

private const val CSV_URL = "https://raw.githubusercontent.com/trainline-eu/stations/master/stations.csv"
private const val SPARQL = "https://query.wikidata.org/sparql"
private const val USER_AGENT = "motis-mcp-app station names generator (https://github.com/litote/motis-mcp-app)"
private val COUNTRIES = setOf("FR", "ES", "IT", "DE", "BE", "NL", "LU", "CH", "AT")
private val LANGUAGES = listOf("fr", "es", "en", "nl", "de", "it")

// labels used to recognize the city in the local name (Catalan for Girona, Barcelona...)
private val SOURCE_LANGUAGES = LANGUAGES + "ca"
private const val BATCH = 25

// labels of an area or a region taken for the city ("Brussels metropolitan area"): never a name of station
private val NOT_A_CITY = Regex(
    """(?U)metropolitan|metropol|\barea\b|\bregion\b|\bregio\b|\bregión\b|\bregione\b|\bzone\b|\bzona\b|\bagglom|\bgebied\b|\bprovince\b|\bprovincia\b|\bkreis\b|\bbezirk\b|\barrondissement\b|\bdistrict\b|\bcomarca\b|\bcanton\b""",
    RegexOption.IGNORE_CASE,
)

// the qualifier following the name of a city in the name of its station: "Frankfurt (Main) Hbf", "Ludwigshafen (Rh) Hbf"
private val QUALIFIER = Regex("""(?U)^\s*\([^)]*\)""")

private val COUNTRY_ITEMS = mapOf(
    "FR" to "Q142", "ES" to "Q29", "IT" to "Q38", "DE" to "Q183", "BE" to "Q31", "NL" to "Q55", "LU" to "Q32", "CH" to "Q39",
    "AT" to "Q40",
)

// languages the stations of a country are named in
private val COUNTRY_LANGUAGES = mapOf(
    "FR" to listOf("fr"), "ES" to listOf("es", "ca"), "IT" to listOf("it"), "DE" to listOf("de"), "BE" to listOf("fr", "nl"),
    "NL" to listOf("nl"), "LU" to listOf("fr", "de"), "CH" to listOf("de", "fr", "it"), "AT" to listOf("de"),
)

/** Labels of a city: language -> label. */
private typealias Labels = Map<String, String>

private val http: HttpClient = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NORMAL).build()

/** Close to the casefold of Python: "ß" -> "ss". */
private fun casefold(text: String): String = text.uppercase().lowercase()

internal fun normalize(text: String): String {
    val decomposed = Normalizer.normalize(casefold(text), Normalizer.Form.NFKD)
    val withoutMarks = decomposed.filter {
        when (Character.getType(it).toByte()) {
            Character.NON_SPACING_MARK, Character.COMBINING_SPACING_MARK, Character.ENCLOSING_MARK -> false
            else -> true
        }
    }
    return words(withoutMarks.map { if (it.isLetterOrDigit()) it else ' ' }.joinToString("")).joinToString(" ")
}

/** The words of [text] separated by whitespaces (split() of Python). */
private fun words(text: String): List<String> = text.split(Regex("\\s+")).filter { it.isNotEmpty() }

private fun sparql(query: String): List<JsonObject> {
    repeat(5) { attempt ->
        try {
            val request = HttpRequest.newBuilder(URI("$SPARQL?query=" + URLEncoder.encode(query, Charsets.UTF_8)))
                .header("Accept", "application/sparql-results+json")
                .header("User-Agent", USER_AGENT)
                .timeout(Duration.ofSeconds(90))
                .build()
            val response = http.send(request, HttpResponse.BodyHandlers.ofString())
            check(response.statusCode() == 200) { "HTTP ${response.statusCode()}" }
            return Json.parseToJsonElement(response.body()).jsonObject["results"]!!.jsonObject["bindings"]!!.jsonArray
                .map { it.jsonObject }
        } catch (e: Exception) { // network, rate limit, timeout: wait and retry
            System.err.println("  retry ${attempt + 1}: $e")
            Thread.sleep(5_000L * (attempt + 1))
        }
    }
    System.err.println("Wikidata unreachable")
    exitProcess(1)
}

private fun JsonObject.value(name: String): String = this[name]!!.jsonObject["value"]!!.jsonPrimitive.content

/** uic -> [{language: label}]: the municipalities (or districts: they have a population too) the station is located in. */
private fun cityLabels(uics: List<String>): Map<String, List<Labels>> {
    val values = uics.joinToString(" ") { "\"$it\"" }
    val langs = SOURCE_LANGUAGES.joinToString(", ") { "\"$it\"" }
    val found = mutableMapOf<String, MutableMap<String, MutableMap<String, String>>>()
    // one query per level (a UNION of the levels times out)
    for (path in listOf("wdt:P131", "wdt:P131/wdt:P131", "wdt:P131/wdt:P131/wdt:P131")) {
        val query = """
SELECT ?uic ?city ?lang ?label WHERE {
  VALUES ?uic { $values }
  ?st wdt:P722 ?uic .
  ?st $path ?city .
  ?city wdt:P1082 [] .
  ?city rdfs:label ?label . BIND(LANG(?label) AS ?lang) FILTER(?lang IN ($langs))
}"""
        for (b in sparql(query)) {
            found.getOrPut(b.value("uic")) { mutableMapOf() }.getOrPut(b.value("city")) { mutableMapOf() }[b.value("lang")] =
                b.value("label")
        }
    }
    return found.mapValues { (_, cities) -> cities.values.toList() }
}

/** The beginnings of [name] made of 1 to 3 words: the city is one of them ("Barcelona Sants" -> "Barcelona", ...). */
internal fun prefixes(name: String): List<String> {
    val words = words(name.replace("–", " ").replace("-", " "))
    val full = words(name)
    return ((1..3).filter { full.size >= it }.map { full.take(it).joinToString(" ") } + words.take(1)).distinct()
}

/** name -> {language: label} of the most populated municipality of [country] of this name (in the language of the country). */
private fun citiesByName(country: String, names: List<String>): Map<String, Labels> {
    val langs = SOURCE_LANGUAGES.joinToString(", ") { "\"$it\"" }
    val found = mutableMapOf<String, Pair<Double, Labels>>()
    for (chunk in names.chunked(20)) {
        val literals = chunk.filter { '"' !in it }
            .flatMap { n -> COUNTRY_LANGUAGES.getValue(country).map { l -> "\"$n\"@$l" } }
            .joinToString(" ")
        if (literals.isEmpty()) continue
        val query = """
SELECT ?q ?city ?pop ?lang ?label WHERE {
  VALUES ?q { $literals }
  ?city rdfs:label ?q .
  ?city wdt:P17 wd:${COUNTRY_ITEMS.getValue(country)} .
  ?city wdt:P1082 ?pop .
  ?city rdfs:label ?label . BIND(LANG(?label) AS ?lang) FILTER(?lang IN ($langs))
}"""
        val byCity = mutableMapOf<Pair<String, String>, Pair<Double, MutableMap<String, String>>>()
        for (b in sparql(query)) {
            val entry = byCity.getOrPut(b.value("q") to b.value("city")) { b.value("pop").toDouble() to mutableMapOf() }
            entry.second[b.value("lang")] = b.value("label")
        }
        for ((key, entry) in byCity) {
            val name = key.first
            val current = found[name]
            if (current == null || entry.first > current.first) found[name] = entry
        }
        Thread.sleep(1_000)
    }
    return found.mapValues { it.value.second }
}

/**
 * (city part of [name], name of the station in each language): the city part is replaced by the label of the city.
 * The city is the candidate one of which labels begins the name (the others are districts).
 */
internal fun localize(name: String, candidates: List<Labels>): Pair<String, Map<String, String>> {
    val norm = normalize(name)
    var best: Triple<String, String, Labels>? = null
    for (labels in candidates) {
        if (labels.values.any { NOT_A_CITY.containsMatchIn(it) }) continue
        for (source in labels.values) {
            val prefix = normalize(source)
            if (prefix.isNotEmpty() && (norm == prefix || norm.startsWith("$prefix ")) &&
                (best == null || prefix.length > best.first.length)
            ) {
                best = Triple(prefix, source, labels)
            }
        }
    }
    if (best == null) return "" to LANGUAGES.associateWith { name }
    val (prefix, source, labels) = best
    var rest = if (casefold(name).startsWith(casefold(source))) name.drop(source.length) else name.drop(prefix.length)
    // the qualifier of a city ("Frankfurt (Main)") is part of it: its translation replaces both, its label
    // in the language of the station ("Frankfurt") keeps the qualifier
    val qualifier = QUALIFIER.find(rest)
    if (qualifier != null) rest = rest.substring(qualifier.range.last + 1)
    val city = name.dropLast(rest.length)

    fun translated(lang: String): String {
        val label = labels[lang]
        // the label of a district named after the city ("Hamburg-Neustadt" for "Neustadt") is not its translation
        if (label == null || normalize(label).endsWith(" " + normalize(source))) return name
        if (qualifier != null && normalize(label) == normalize(source)) return name
        // the rest of the name keeps its own punctuation ("Barcelona Sants", "Figueres – Vilafant")
        return label + rest
    }

    return city to LANGUAGES.associateWith { translated(it) }
}

/** The rows of a CSV separated by [delimiter], as maps header -> value (DictReader of Python). */
private fun readCsv(text: String, delimiter: Char): List<Map<String, String>> {
    fun parse(line: String): List<String> {
        val cells = mutableListOf<String>()
        val cell = StringBuilder()
        var quoted = false
        var i = 0
        while (i < line.length) {
            val c = line[i]
            when {
                quoted && c == '"' && line.getOrNull(i + 1) == '"' -> cell.append('"').also { i++ }
                c == '"' -> quoted = !quoted
                !quoted && c == delimiter -> cells += cell.toString().also { cell.clear() }
                else -> cell.append(c)
            }
            i++
        }
        return cells + cell.toString()
    }
    val lines = text.lineSequence().map { it.removeSuffix("\r") }.filter { it.isNotEmpty() }.toList()
    val header = parse(lines.first())
    return lines.drop(1).map { line ->
        val cells = parse(line)
        header.indices.associate { header[it] to cells.getOrElse(it) { "" } }
    }
}

/** [value] with 5 decimals, rounded as Python formats it ("%.5f": the exact binary value, half to even). */
private fun fiveDecimals(value: String): String = BigDecimal(value.toDouble()).setScale(5, RoundingMode.HALF_EVEN).toPlainString()

/** Arguments: the generated file, then the Trainline CSV (downloaded when not given). */
fun main(args: Array<String>) {
    val out = File(args.getOrElse(0) { "server/src/main/resources/stations/stations.tsv" })
    val text = args.getOrNull(1)?.let { File(it).readText() } ?: run {
        val request = HttpRequest.newBuilder(URI(CSV_URL)).header("User-Agent", USER_AGENT).timeout(Duration.ofSeconds(120)).build()
        http.send(request, HttpResponse.BodyHandlers.ofString()).body()
    }
    val rows = readCsv(text, ';').filter { r ->
        r.getValue("uic").isNotEmpty() && r["is_suggestable"] == "t" && r["country"] in COUNTRIES &&
            r.getValue("latitude").isNotEmpty() && r.getValue("longitude").isNotEmpty() &&
            // reduced scope: the main stations, the ones sold by Renfe (the international trains of Spain) and all the ones
            // of France sold by the SNCF (the train stops named "Gare SNCF" by their feed take the name of their station)
            (r["is_main_station"] == "t" || r["renfe_is_enabled"] == "t" || (r["country"] == "FR" && r["sncf_is_enabled"] == "t"))
    }
    System.err.println("${rows.size} stations")
    val labels = mutableMapOf<String, MutableList<Labels>>()
    val uics = rows.map { it.getValue("uic") }.toSortedSet().toList()
    for (chunk in uics.chunked(BATCH).withIndex()) {
        cityLabels(chunk.value).forEach { (uic, cities) -> labels[uic] = cities.toMutableList() }
        System.err.println("  ${minOf((chunk.index + 1) * BATCH, uics.size)}/${uics.size}")
        Thread.sleep(1_000)
    }
    fun nameOf(r: Map<String, String>) = r.getValue("name").trim()
    // the stations that Wikidata does not know by their UIC code: the city is found by the beginning of the name
    val unresolved = rows.filter { localize(nameOf(it), labels[it.getValue("uic")].orEmpty()).first.isEmpty() }
    for (country in COUNTRIES) {
        val todo = unresolved.filter { it["country"] == country }
        val names = todo.flatMap { prefixes(nameOf(it)) }.toSortedSet().toList()
        val cities = if (names.isNotEmpty()) citiesByName(country, names) else emptyMap()
        for (r in todo) {
            val candidate = prefixes(nameOf(r)).sortedByDescending { it.length }.firstOrNull { it in cities } ?: continue
            labels.getOrPut(r.getValue("uic")) { mutableListOf() } += cities.getValue(candidate)
        }
        System.err.println("  $country: ${todo.size} by name")
    }
    out.parentFile.mkdirs()
    val seen = mutableSetOf<String>()
    out.bufferedWriter().use { f ->
        f.write("# Generated by the tools/station-names module from Trainline stations (ODbL) and Wikidata (CC0). Do not edit.\n")
        f.write("# uic\tlat\tlon\tmain\tname\tcity\t" + LANGUAGES.joinToString("\t") + "\t(empty: same as name)\n")
        for (r in rows.sortedBy { it.getValue("uic") }) {
            if (!seen.add(r.getValue("uic"))) continue
            val name = nameOf(r)
            val (city, names) = localize(name, labels[r.getValue("uic")].orEmpty())
            val cells = listOf(
                r.getValue("uic"), fiveDecimals(r.getValue("latitude")), fiveDecimals(r.getValue("longitude")),
                if (r["is_main_station"] == "t") "1" else "0", name, city,
            ) + LANGUAGES.map { if (names.getValue(it) == name) "" else names.getValue(it) }
            f.write(cells.joinToString("\t") + "\n")
        }
    }
    System.err.println("${seen.size} written to $out")
}
