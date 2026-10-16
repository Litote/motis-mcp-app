// SNCF pictograms: logos of the train brands and pictograms of the Île-de-France lines (see sncf/README.md).
import eurostar from "./sncf/eurostar.svg?raw";
import frecciarossa from "./sncf/frecciarossa.svg?raw";
import inoui from "./sncf/inoui.svg?raw";
import intercites from "./sncf/intercites.svg?raw";
import lyria from "./sncf/lyria.svg?raw";
import ouigo from "./sncf/ouigo.svg?raw";
import thalys from "./sncf/thalys.svg?raw";
import { esc } from "./format";

const linePictograms: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob<string>("./sncf/line-*.svg", { query: "?raw", import: "default", eager: true })).map(
    ([path, svg]) => [path.replace(/^.*line-(.*)\.svg$/, "$1"), svg.trim()],
  ),
);

export const RAIL_MODES = new Set([
  "RAIL",
  "HIGHSPEED_RAIL",
  "LONG_DISTANCE",
  "NIGHT_RAIL",
  "REGIONAL_FAST_RAIL",
  "REGIONAL_RAIL",
  "SUBURBAN",
]);

/** Filter of the trains in a query: RAIL also includes the metros for MOTIS. */
export const TRAIN_MODES = [...RAIL_MODES].filter((mode) => mode !== "RAIL");

/**
 * Logos of the brands, by the start of the line name ("TGV INOUI 6633") or the agency; [lineAgency]: agency required with
 * [line] (IC is also the Intercity of other countries).
 */
const BRANDS: { logo: string; line?: RegExp; lineAgency?: RegExp; agency?: RegExp }[] = [
  { logo: inoui.trim(), line: /^TGV\s*INOUI\b/i },
  { logo: ouigo.trim(), line: /^OUIGO/i },
  { logo: lyria.trim(), line: /^(TGV\s*)?LYRIA\b/i },
  { logo: thalys.trim(), line: /^THALYS\b/i },
  { logo: eurostar.trim(), line: /^(EST|EUROSTAR)\b/i, agency: /^Eurostar$/i },
  { logo: frecciarossa.trim(), line: /^(FR|FRECCIAROSSA)$/i },
  { logo: intercites.trim(), line: /^(IC|INTERCIT[EÉ]S)$/i, lineAgency: /^(SNCF\b.*)?$/i },
];

/** Agencies of the RER, Transilien and tram lines of Île-de-France: other networks have lines named "A" or "T1". */
const IDF_AGENCIES = /\b(RER|Transilien|SNCF|RATP)\b/i;

export interface Train {
  /** Logo of the brand (SVG), when known. */
  logo?: string;
  /** Brand or category of the train, e.g. "TGV INOUI", "TER". */
  brand: string;
  number?: string;
}

/** Line code of the SNCF regional trains of some feeds ("C17", "K14": lines of TER Hauts-de-France), shown as TER. */
const TER_LINE_CODE = /^[A-Z]{1,2}\d{1,3}$/;
const REGIONAL_MODES = new Set(["REGIONAL_FAST_RAIL", "REGIONAL_RAIL"]);

function isTerLine(mode: string, line: string, agency?: string | null): boolean {
  return REGIONAL_MODES.has(mode) && /^SNCF\b/i.test(agency ?? "") && TER_LINE_CODE.test(line);
}

/** Brand and number of a train, from its line name ("TGV INOUI 6633" or "TER" with number 891001); null for other modes. */
export function train(mode: string, line?: string | null, agency?: string | null, number?: string | null): Train | null {
  if (!RAIL_MODES.has(mode) || !line) return null;
  const match = /^(.*\S)\s+(\d+)$/.exec(line.trim());
  const lineBrand = match && (!number || match[2] === number) ? match[1] : line.trim();
  const brand = isTerLine(mode, lineBrand, agency) ? "TER" : lineBrand;
  const logo = BRANDS.find(
    (b) => (b.line?.test(brand) && (!b.lineAgency || b.lineAgency.test(agency ?? ""))) || (agency && b.agency?.test(agency)),
  )?.logo;
  return { logo, brand, number: number ?? match?.[2] };
}

/** Pictogram (SVG) of a RER, Transilien or tram line of Île-de-France, or null. */
export function linePictogram(mode: string, line?: string | null, agency?: string | null): string | null {
  const svg = line ? linePictograms[line.trim()] : undefined;
  if (!svg || !agency || !IDF_AGENCIES.test(agency)) return null;
  const modeMatches = line!.startsWith("T") ? mode === "TRAM" : RAIL_MODES.has(mode);
  return modeMatches ? svg : null;
}

/** Badge of an SNCF train or Île-de-France line with its pictogram, or null when there is none. */
export function sncfBadge(mode: string, line?: string | null, agency?: string | null, number?: string | null): string | null {
  const pictogram = linePictogram(mode, line, agency);
  if (pictogram) return `<span class="sncf-line ${line!.startsWith("T") ? "tram" : ""}" title="${esc(line)}">${pictogram}</span>`;
  const t = train(mode, line, agency, number);
  if (!t?.logo) return null;
  const numberSpan = t.number ? `<span>${esc(t.number)}</span>` : "";
  return `<span class="badge sncf-train" title="${esc(line)}">${t.logo}${numberSpan}</span>`;
}
