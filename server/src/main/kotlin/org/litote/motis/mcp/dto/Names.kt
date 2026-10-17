package org.litote.motis.mcp.dto

private val WORD = Regex("""\p{L}+""")

private const val VOWELS = "AEIOUYÀÂÄÁÉÈÊËÍÌÎÏÓÒÔÖÚÙÛÜŸ"

/** Small words of the place names, in lowercase but at the start: "Paris Gare de Lyon", "Saint-Germain-en-Laye". */
private val SMALL_WORDS =
    setOf(
        "de", "du", "des", "la", "le", "les", "et", "en", "sur", "sous", "au", "aux", "lès", "lez",
        "di", "del", "della", "dei", "degli", "da", "al", "am", "im", "an", "der", "bei",
    )

/** Abbreviations without vowel that are not acronyms. */
private val ABBREVIATIONS = setOf("ST", "MT")

/**
 * Name of a stop or of a destination as displayed: some feeds write them in capitals ("LYON PERRACHE" of Trenitalia),
 * the others in mixed case ("Lyon Perrache"). A name in capitals gets the mixed case, except its acronyms (words without
 * vowel: "TGV", "CDG"); a name already in mixed case is kept as is.
 */
fun displayName(name: String): String {
    if (name.any(Char::isLowerCase) || name.count(Char::isLetter) < 2) return name
    return WORD.replace(name) { match ->
        val word = match.value
        val lower = word.lowercase()
        val first = name.substring(0, match.range.first).none(Char::isLetter)
        // d'Abeau, l'Isle
        val elision = word.length == 1 && name.getOrNull(match.range.last + 1).let { it == '\'' || it == '’' }
        when {
            !first && (elision || lower in SMALL_WORDS) -> lower
            elision -> word
            word !in ABBREVIATIONS && word.none { it in VOWELS } -> word
            else -> lower.replaceFirstChar { it.titlecase() }
        }
    }
}
