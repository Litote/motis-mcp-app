// What the boards of the railway stations of a country (see index.ts) are given to draw a departure.
import { delayMinutes } from "../shared/format";
import { t } from "../shared/i18n";
import { RAIL_MODES, train } from "../shared/sncf";
import type { DeparturesResult, StopTimeDto } from "../shared/types";

/** A departure (or an arrival) of a board, and what the view knows about it. */
export interface BoardRow {
  st: StopTimeDto;
  /** Index of the departure in the result, in `data-index`. */
  index: number;
  arriveBy: boolean;
  /** Time zone of the station. */
  tz?: string;
  /** Classes of the departure gone (`past`) and of the one of the trip opened (`open`). */
  classes: string;
  /** Mark of the alerts it shares with other departures (listed under the banner of the board). */
  alertMark: string;
  /** Its own alerts, under it. */
  alertLine: string;
  /** Marks its time when theoretical: the board mixes real and theoretical times. */
  markTheoretical: boolean;
}

/** Board of the railway stations of a country, like the ones at its stations. */
export interface CountryBoard {
  /** Class of the `<ol>` of the board (with `arrivals` for the arrivals). */
  className: string;
  /** The station gets this board. */
  matches(data: DeparturesResult): boolean;
  /** The departure is on the board: the others (buses, metros...) are listed below it, on the generic board. */
  onBoard(st: StopTimeDto): boolean;
  /** `<li>` of a departure, with `data-index`. */
  row(row: BoardRow): string;
  /** `<li>` heading the departures (or the arrivals), if any: its title, its column labels. */
  header?(arriveBy: boolean): string;
  /** Style of the board. */
  css: string;
}

/** The station of [data] is in the time zone [tz] of a country, and has trains: not a bus or metro stop. */
export const railwayStationIn = (tz: string) => (data: DeparturesResult) =>
  data.stop.tz === tz && data.stopTimes.some((st) => RAIL_MODES.has(st.mode));

/** Delay of a departure in minutes, in real time; 0 without it. */
export const delayOf = (st: StopTimeDto) => (st.realTime ? delayMinutes(st.time, st.scheduledTime) : 0);

/** Digits at the end of [value], if any ("2229" of "RE_2 - 2229"); no regular expression: a backtracking one is slow. */
function trailingDigits(value?: string): string | undefined {
  const text = value?.trimEnd() ?? "";
  let start = text.length;
  while (start > 0 && text[start - 1] >= "0" && text[start - 1] <= "9") start--;
  return start < text.length ? text.slice(start) : undefined;
}

/**
 * Category and number of a train: "ICE" and "546" for the line "ICE 546", the line ("RE2", "C4a") when it is not
 * followed by the number. The number of some feeds has the category or the line ("ICE 546", "RE_2 - 2229"): its digits.
 */
export function trainName(st: StopTimeDto): { category: string; number?: string } | null {
  const tr = train(st.mode, st.line, st.agency, trailingDigits(st.trainNumber));
  return tr ? { category: tr.brand, number: tr.number } : null;
}

/** Long-distance trains (high speed, intercity, night trains). */
export const LONG_DISTANCE_MODES = new Set(["HIGHSPEED_RAIL", "LONG_DISTANCE", "NIGHT_RAIL"]);

/** A theoretical time (no real time) cannot be told from an on-time one: marked on a board mixing both. */
export const theoreticalMark = () =>
  `<span class="muted theoretical" title="${t("departures.theoretical.title")}">${t("departures.theoretical")}</span>`;

/**
 * The end of the trip of a departure (its origin for an arrival), the big label of a board, and the stops in between
 * (from the station, or to it for an arrival); the headsign when the stops are unknown.
 */
export function tripEnd(st: StopTimeDto, arriveBy: boolean): { label: string; time?: string; via: { name: string; time?: string }[] } {
  const stops = st.stops ?? [];
  const end = arriveBy ? stops[0] : stops.at(-1);
  return { label: end?.name ?? st.headsign, time: end?.time, via: arriveBy ? stops.slice(1) : stops.slice(0, -1) };
}
