#!/usr/bin/env python3
"""Generates server/src/main/resources/stations/stations.tsv: the railway stations with their name in each language.

Sources:
  * Trainline stations (https://github.com/trainline-eu/stations, ODbL): UIC code, coordinates and local name;
  * Wikidata (CC0): labels of the municipality of the station (P722 = UIC code, P131 = located in), used to translate the
    city part of the name ("Girona" -> "Gérone", "Barcelona Sants" -> "Barcelone Sants").

Usage: scripts/generate_station_names.py [stations.csv]   (downloaded when no file is given)
Only the standard library is used. The result is derived from Trainline data: it is published under the ODbL (see
server/src/main/resources/stations/README.md).
"""
import csv
import io
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

CSV_URL = "https://raw.githubusercontent.com/trainline-eu/stations/master/stations.csv"
SPARQL = "https://query.wikidata.org/sparql"
USER_AGENT = "motis-mcp-app station names generator (https://github.com/litote/motis-mcp-app)"
COUNTRIES = {"FR", "ES", "IT", "DE", "BE", "NL", "LU", "CH", "AT"}
LANGUAGES = ["fr", "es", "en", "nl", "de", "it"]
# labels used to recognize the city in the local name (Catalan for Girona, Barcelona...)
SOURCE_LANGUAGES = LANGUAGES + ["ca"]
BATCH = 25
OUT = Path(__file__).resolve().parent.parent / "server/src/main/resources/stations/stations.tsv"


# labels of an area or a region taken for the city ("Brussels metropolitan area"): never a name of station
NOT_A_CITY = re.compile(r"metropolitan|metropol|\barea\b|\bregion\b|\bregio\b|\bregión\b|\bregione\b|\bzone\b|\bzona\b|\bagglom|\bgebied\b|\bprovince\b|\bprovincia\b|\bkreis\b|\bbezirk\b|\barrondissement\b|\bdistrict\b|\bcomarca\b|\bcanton\b", re.I)


# the qualifier following the name of a city in the name of its station: "Frankfurt (Main) Hbf", "Ludwigshafen (Rh) Hbf"
QUALIFIER = re.compile(r"^\s*\([^)]*\)")


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKD", text.casefold())
    text = "".join(c for c in text if not unicodedata.combining(c))
    return " ".join("".join(c if c.isalnum() else " " for c in text).split())


def sparql(query: str) -> list:
    for attempt in range(5):
        try:
            request = urllib.request.Request(
                SPARQL + "?" + urllib.parse.urlencode({"query": query}),
                headers={"Accept": "application/sparql-results+json", "User-Agent": USER_AGENT},
            )
            with urllib.request.urlopen(request, timeout=90) as response:
                return json.load(response)["results"]["bindings"]
        except Exception as e:  # network, rate limit, timeout: wait and retry
            print(f"  retry {attempt + 1}: {e}", file=sys.stderr)
            time.sleep(5 * (attempt + 1))
    raise SystemExit("Wikidata unreachable")


def city_labels(uics: list) -> dict:
    """uic -> [{language: label}]: the municipalities (or districts: they have a population too) the station is located in."""
    values = " ".join(f'"{u}"' for u in uics)
    langs = ", ".join(f'"{l}"' for l in SOURCE_LANGUAGES)
    found = {}
    # one query per level (a UNION of the levels times out)
    for path in ["wdt:P131", "wdt:P131/wdt:P131", "wdt:P131/wdt:P131/wdt:P131"]:
        query = f"""
SELECT ?uic ?city ?lang ?label WHERE {{
  VALUES ?uic {{ {values} }}
  ?st wdt:P722 ?uic .
  ?st {path} ?city .
  ?city wdt:P1082 [] .
  ?city rdfs:label ?label . BIND(LANG(?label) AS ?lang) FILTER(?lang IN ({langs}))
}}"""
        for b in sparql(query):
            found.setdefault(b["uic"]["value"], {}).setdefault(b["city"]["value"], {})[b["lang"]["value"]] = b["label"]["value"]
    return {uic: list(cities.values()) for uic, cities in found.items()}


COUNTRY_ITEMS = {"FR": "Q142", "ES": "Q29", "IT": "Q38", "DE": "Q183", "BE": "Q31", "NL": "Q55", "LU": "Q32", "CH": "Q39", "AT": "Q40"}
# languages the stations of a country are named in
COUNTRY_LANGUAGES = {"FR": ["fr"], "ES": ["es", "ca"], "IT": ["it"], "DE": ["de"], "BE": ["fr", "nl"], "NL": ["nl"], "LU": ["fr", "de"],
                      "CH": ["de", "fr", "it"], "AT": ["de"]}


def prefixes(name: str) -> list:
    """The beginnings of [name] made of 1 to 3 words: the city is one of them ("Barcelona Sants" -> "Barcelona", ...)."""
    words = name.replace("–", " ").replace("-", " ").split()
    full = name.split()
    return list(dict.fromkeys([" ".join(full[:n]) for n in (1, 2, 3) if len(full) >= n] + [w for w in words[:1]]))


def cities_by_name(country: str, names: list) -> dict:
    """name -> {language: label} of the most populated municipality of [country] of this name (in the language of the country)."""
    langs = ", ".join(f'"{l}"' for l in SOURCE_LANGUAGES)
    found = {}
    for i in range(0, len(names), 20):
        literals = " ".join(f'"{n}"@{l}' for n in names[i:i + 20] for l in COUNTRY_LANGUAGES[country] if '"' not in n)
        if not literals:
            continue
        query = f"""
SELECT ?q ?city ?pop ?lang ?label WHERE {{
  VALUES ?q {{ {literals} }}
  ?city rdfs:label ?q .
  ?city wdt:P17 wd:{COUNTRY_ITEMS[country]} .
  ?city wdt:P1082 ?pop .
  ?city rdfs:label ?label . BIND(LANG(?label) AS ?lang) FILTER(?lang IN ({langs}))
}}"""
        by_city = {}
        for b in sparql(query):
            key = (b["q"]["value"], b["city"]["value"])
            entry = by_city.setdefault(key, (float(b["pop"]["value"]), {}))
            entry[1][b["lang"]["value"]] = b["label"]["value"]
        for (name, _), (pop, labels) in by_city.items():
            if name not in found or pop > found[name][0]:
                found[name] = (pop, labels)
        time.sleep(1)
    return {name: labels for name, (_, labels) in found.items()}


def localize(name: str, candidates: list) -> tuple:
    """(city part of [name], name of the station in each language): the city part is replaced by the label of the city.
    The city is the candidate one of which labels begins the name (the others are districts)."""
    norm = normalize(name)
    best = None
    for labels in candidates:
        if any(NOT_A_CITY.search(label) for label in labels.values()):
            continue
        for source in labels.values():
            prefix = normalize(source)
            if prefix and (norm == prefix or norm.startswith(prefix + " ")) and (best is None or len(prefix) > len(best[0])):
                best = (prefix, source, labels)
    if best:
        prefix, source, labels = best
        rest = name[len(source):] if name.casefold().startswith(source.casefold()) else name[len(prefix):]
        # the qualifier of a city ("Frankfurt (Main)") is part of it: its translation replaces both, its label
        # in the language of the station ("Frankfurt") keeps the qualifier
        qualifier = QUALIFIER.match(rest)
        if qualifier:
            rest = rest[qualifier.end():]
        city = name[:len(name) - len(rest)]

        def translated(lang: str) -> str:
            label = labels.get(lang)
            # the label of a district named after the city ("Hamburg-Neustadt" for "Neustadt") is not its translation
            if label is None or normalize(label).endswith(" " + normalize(source)):
                return name
            if qualifier and normalize(label) == normalize(source):
                return name
            # the rest of the name keeps its own punctuation ("Barcelona Sants", "Figueres – Vilafant")
            return label + rest

        return city, {lang: translated(lang) for lang in LANGUAGES}
    return "", {lang: name for lang in LANGUAGES}


def main() -> None:
    if len(sys.argv) > 1:
        text = Path(sys.argv[1]).read_text(encoding="utf-8")
    else:
        with urllib.request.urlopen(urllib.request.Request(CSV_URL, headers={"User-Agent": USER_AGENT}), timeout=120) as r:
            text = r.read().decode("utf-8")
    rows = [
        r for r in csv.DictReader(io.StringIO(text), delimiter=";")
        if r["uic"] and r["is_suggestable"] == "t" and r["country"] in COUNTRIES and r["latitude"] and r["longitude"]
        # reduced scope: the main stations and the ones sold by Renfe (the international trains of Spain)
        and (r["is_main_station"] == "t" or r["renfe_is_enabled"] == "t")
    ]
    print(f"{len(rows)} stations", file=sys.stderr)
    labels = {}
    uics = sorted({r["uic"] for r in rows})
    for i in range(0, len(uics), BATCH):
        labels.update(city_labels(uics[i:i + BATCH]))
        print(f"  {min(i + BATCH, len(uics))}/{len(uics)}", file=sys.stderr)
        time.sleep(1)
    # the stations that Wikidata does not know by their UIC code: the city is found by the beginning of the name
    unresolved = [r for r in rows if not localize(r["name"].strip(), labels.get(r["uic"], []))[0]]
    for country in COUNTRIES:
        todo = [r for r in unresolved if r["country"] == country]
        names = sorted({p for r in todo for p in prefixes(r["name"].strip())})
        cities = cities_by_name(country, names) if names else {}
        for r in todo:
            for candidate in sorted(prefixes(r["name"].strip()), key=len, reverse=True):
                if candidate in cities:
                    labels.setdefault(r["uic"], []).append(cities[candidate])
                    break
        print(f"  {country}: {len(todo)} by name", file=sys.stderr)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    seen = set()
    with OUT.open("w", encoding="utf-8", newline="") as f:
        f.write("# Generated by scripts/generate_station_names.py from Trainline stations (ODbL) and Wikidata (CC0). Do not edit.\n")
        f.write("# uic\tlat\tlon\tmain\tname\tcity\t" + "\t".join(LANGUAGES) + "\t(empty: same as name)\n")
        for r in sorted(rows, key=lambda r: r["uic"]):
            if r["uic"] in seen:
                continue
            seen.add(r["uic"])
            name = r["name"].strip()
            city, names = localize(name, labels.get(r["uic"], []))
            cells = [r["uic"], f"{float(r['latitude']):.5f}", f"{float(r['longitude']):.5f}",
                     "1" if r["is_main_station"] == "t" else "0", name, city]
            cells += ["" if names[l] == name else names[l] for l in LANGUAGES]
            f.write("\t".join(cells) + "\n")
    print(f"{len(seen)} written to {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
