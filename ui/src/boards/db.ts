// Board of the German railway stations, like the timetables posted at the stations of the Deutsche Bahn: yellow
// "Abfahrt" for the departures, white "Ankunft" for the arrivals, the long-distance trains in red.
import { esc, lineBadge, time } from "../shared/format";
import { t } from "../shared/i18n";
import { RAIL_MODES } from "../shared/sncf";
import type { StopTimeDto } from "../shared/types";
import { LONG_DISTANCE_MODES, delayOf, railwayStationIn, theoreticalMark, trainName, tripEnd, type BoardRow, type CountryBoard } from "./row";

/** "RE 20" for the line "RE20": the category apart from the line number, as on the timetables. */
const spaced = (line: string) => line.replace(/^([A-Za-zÄÖÜäöü]+)(\d+)$/, "$1 $2");

/**
 * Train of a departure: "ICE 546" (a category and the train number), "RE 20" and the train number below it (a
 * regional line), the badge of an S-Bahn line in the color of its network.
 */
function product(st: StopTimeDto): string {
  if (st.mode === "SUBURBAN") return lineBadge(st.mode, st.line, st.routeColor, st.routeTextColor, st.agency);
  const tr = trainName(st);
  if (!tr) return esc(st.line);
  const number = tr.number?.replace(/^0+(?=\d)/, "");
  // a bare category ("ICE"): named by the train number
  if (number && /^[A-Za-z]+$/.test(tr.category)) return `<strong>${esc(tr.category)} ${esc(number)}</strong>`;
  const numberSpan = number ? `<span class="nummer">${esc(number)}</span>` : "";
  return `<strong>${esc(spaced(tr.category))}</strong>${numberSpan}`;
}

function row({ st, index, arriveBy, tz, classes, alertMark, alertLine, markTheoretical }: BoardRow): string {
  const end = tripEnd(st, arriveBy);
  const via = end.via.map((s) => `${esc(s.name)} ${time(s.time, tz)}`).join(" – ");
  const delay = delayOf(st);
  let status = "";
  if (st.cancelled) status = `<span class="ausfall">${t("departures.cancelled")}</span>`;
  else if (delay > 0)
    status = `<span class="verspaetung" title="${t("departures.expected", { time: time(st.time, tz) })}">${t("departures.delay", { minutes: delay })}</span>`;
  else if (markTheoretical && !st.realTime) status = theoreticalMark();
  const state = [LONG_DISTANCE_MODES.has(st.mode) ? "fern" : "", st.cancelled ? "deleted" : "", classes].filter(Boolean).join(" ");
  const endTime = end.time ? ` <span class="ziel-zeit">${time(end.time, tz)}</span>` : "";
  return `
    <li class="train ${state}" data-index="${index}">
      <span class="zeit">${time(st.scheduledTime ?? st.time, tz)}</span>
      <span class="zug">${product(st)}</span>
      <div class="richtung">
        <div class="ziel"><span><strong>${esc(end.label)}</strong>${endTime}</span>${alertMark}${status}</div>
        <div class="via" title="${esc(end.via.map((s) => s.name).join(" – "))}">${via}</div>
        ${alertLine}
      </div>
      <span class="gleis" title="${st.track ? t("track", { track: esc(st.track) }) : ""}">${esc(st.track)}</span>
    </li>`;
}

/** Colors of the posted timetables: black on yellow (departures) or white (arrivals), whatever the theme. */
const css = `
  ol.db-board { --paper: #ffdc00; --ink: #000; --red: #c50014; list-style: none; margin: 0; padding: 0 8px; background: var(--paper); color: var(--ink);
    border-radius: var(--border-radius-sm); overflow: hidden; border-top: 6px solid var(--ink); }
  ol.db-board.arrivals { --paper: #fff; border: 1px solid #bbb; border-top: 6px solid var(--ink); }
  ol.db-board .train { display: grid; grid-template-columns: 3rem 4.75rem minmax(0, 1fr) 2.25rem; gap: 8px; align-items: start;
    padding: 6px 0; border-bottom: 1px solid var(--ink); cursor: pointer; }
  ol.db-board .train:last-child { border-bottom: 0; }
  ol.db-board .train:hover { background: rgba(0, 0, 0, 0.06); }
  ol.db-board .train.past > * { opacity: 0.5; }
  ol.db-board .train.open { box-shadow: inset 0 0 0 3px var(--ink); }
  ol.db-board .zeit { font-size: 1.15em; font-weight: 800; font-variant-numeric: tabular-nums; }
  ol.db-board .zug { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; white-space: nowrap; }
  ol.db-board .zug strong { overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  ol.db-board .nummer { font-size: 0.7rem; }
  ol.db-board .fern .zeit, ol.db-board .fern .zug strong { color: var(--red); }
  ol.db-board .ziel { display: flex; align-items: center; gap: 0.25rem; min-width: 0; }
  ol.db-board .ziel > span:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ol.db-board .ziel-zeit { font-variant-numeric: tabular-nums; }
  ol.db-board .deleted .ziel > span:first-child { text-decoration: line-through; }
  ol.db-board .via { margin-top: 1px; font-size: 0.75rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ol.db-board .via:empty { display: none; }
  ol.db-board .verspaetung { flex: none; color: var(--red); font-size: 0.75rem; font-weight: 700; white-space: nowrap; }
  ol.db-board .ausfall { flex: none; padding: 0.05rem 0.3rem; background: var(--red); color: #fff; font-size: 0.75rem; font-weight: 700; white-space: nowrap; }
  ol.db-board .theoretical { flex: none; color: #444; font-size: 0.7rem; white-space: nowrap; }
  ol.db-board .alert-mark, ol.db-board .alert-line { color: var(--ink); }
  ol.db-board .alert-mark.severe, ol.db-board .alert-line.severe { color: var(--red); }
  ol.db-board .gleis { font-size: 1.25em; font-weight: 800; text-align: right; white-space: nowrap; overflow: hidden; }
  :root[data-display-mode="fullscreen"] ol.db-board { font-size: 17px; }
  :root[data-display-mode="fullscreen"] ol.db-board .train { grid-template-columns: 3.6rem 5.5rem minmax(0, 1fr) 2.75rem; padding: 8px 0; }
`;

/** German railway stations, not the bus, tram or U-Bahn stops; the trains (with the S-Bahn) on the board. */
export const dbBoard: CountryBoard = {
  className: "db-board",
  matches: railwayStationIn("Europe/Berlin"),
  onBoard: (st) => RAIL_MODES.has(st.mode),
  row,
  css,
};
