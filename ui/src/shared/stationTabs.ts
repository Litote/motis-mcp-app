// Tabs of the board of a railway station: trains (long-distance and regional), each Île-de-France train line, metros,
// trams and buses, from the lines of the station given by the server.
import { t } from "./i18n";
import { linePictogram } from "./sncf";
import type { StationLineDto, StopTimeDto } from "./types";

export interface StationTab {
  id: string;
  label: string;
  /** Pictogram of the line (SVG), shown instead of the label. */
  pictogram?: string;
  /** Filter of the departures of the tab, as arguments of the departures tool (with station true). */
  modes: string[];
  lines?: string[];
}

const LONG_DISTANCE = ["HIGHSPEED_RAIL", "LONG_DISTANCE", "NIGHT_RAIL"];
const REGIONAL = ["REGIONAL_FAST_RAIL", "REGIONAL_RAIL", "SUBURBAN"];
const TRAINS = [...LONG_DISTANCE, ...REGIONAL];
const SUBWAY = ["SUBWAY", "METRO"];
const TRAM = ["TRAM"];
const BUS = ["BUS", "COACH"];

/** Line name of a stop time, without the number of the train (as the server names the station lines). */
export function lineName(line: string): string {
  const name = line.trim();
  // no regular expression: a backtracking one is slow on long names
  let numberStart = name.length;
  while (numberStart > 0 && name[numberStart - 1] >= "0" && name[numberStart - 1] <= "9") numberStart--;
  const head = name.slice(0, numberStart);
  const trimmedHead = head.trimEnd();
  return numberStart < name.length && trimmedHead.length < head.length ? trimmedHead : name;
}

/** "RER A", "Transilien R": the agency names the network of the Île-de-France lines. */
function idfLineLabel(line: StationLineDto): string {
  const network = /\b(RER|Transilien)\b/i.exec(line.agency)?.[1];
  return network ? `${network} ${line.line}` : line.line;
}

/** Train lines of the station: the Île-de-France lines (a tab each, by line) and the others (one tab). */
function trainLines(lines: StationLineDto[]): { idf: Map<string, StationTab>; trains: Set<string> } {
  const idf = new Map<string, StationTab>();
  const trains = new Set<string>();
  for (const line of lines.filter((l) => TRAINS.includes(l.mode))) {
    const pictogram = REGIONAL.includes(line.mode) ? linePictogram(line.mode, line.line, line.agency) : null;
    if (!pictogram) trains.add(line.line);
    // the same line may be in two feeds (SNCF and IDFM): one tab
    else if (!idf.has(line.line)) {
      idf.set(line.line, { id: `line-${line.line}`, label: idfLineLabel(line), pictogram, modes: REGIONAL, lines: [line.line] });
    }
  }
  return { idf, trains };
}

/** Tabs of the station, in the order of the boards of the SNCF stations; none when its lines fit a single tab. */
export function stationTabs(lines: StationLineDto[]): StationTab[] {
  const has = (modes: string[]) => lines.some((l) => modes.includes(l.mode));
  const { idf, trains } = trainLines(lines);
  const tabs: StationTab[] = [];
  // long-distance and regional trains together, without the Île-de-France lines (their own tabs)
  if (trains.size) tabs.push({ id: "trains", label: t("departures.tab.trains"), modes: TRAINS, lines: idf.size ? [...trains] : undefined });
  // RER before Transilien, then by line
  tabs.push(...[...idf.values()].sort((a, b) => a.label.localeCompare(b.label)));

  if (has(SUBWAY)) tabs.push({ id: "subway", label: t("departures.tab.subway"), modes: SUBWAY });
  if (has(TRAM)) tabs.push({ id: "tram", label: t("departures.tab.tram"), modes: TRAM });
  if (has(BUS)) tabs.push({ id: "bus", label: t("departures.tab.bus"), modes: BUS });
  return tabs.length > 1 ? tabs : [];
}

/** The stop time is one of the departures of the [tab]. */
export function inTab(tab: StationTab, st: StopTimeDto): boolean {
  return tab.modes.includes(st.mode) && (!tab.lines || tab.lines.includes(lineName(st.line)));
}
