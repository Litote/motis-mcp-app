// Board of the British railway stations, like the dot-matrix boards of the National Rail stations: amber on black,
// the columns Time, Destination, Plat, Expected ("On time", the expected time, "Cancelled"), the stops and the operator
// below the destination.
import { esc, time } from "../shared/format";
import { t } from "../shared/i18n";
import { RAIL_MODES } from "../shared/sncf";
import { delayOf, railwayStationIn, theoreticalMark, tripEnd, type BoardRow, type CountryBoard } from "./row";

function row({ st, index, arriveBy, tz, classes, alertMark, alertLine, markTheoretical }: BoardRow): string {
  const end = tripEnd(st, arriveBy);
  const stops = end.via.map((s) => esc(s.name)).join(", ");
  let expected = "";
  if (st.cancelled) expected = `<span class="cancelled">${t("departures.cancelled")}</span>`;
  else if (delayOf(st) > 0) expected = `<span class="late" title="${t("departures.expected", { time: time(st.time, tz) })}">${time(st.time, tz)}</span>`;
  else if (st.realTime) expected = `<span>${t("departures.onTime")}</span>`;
  else if (markTheoretical) expected = theoreticalMark();
  return `
    <li class="train ${st.cancelled ? "deleted" : ""} ${classes}" data-index="${index}">
      <span class="time">${time(st.scheduledTime ?? st.time, tz)}</span>
      <div class="destination">
        <div class="name"><span>${esc(end.label)}</span>${alertMark}</div>
        <div class="calling" title="${esc(stops)}">${stops}</div>
        <div class="operator">${esc(st.agency)}</div>
        ${alertLine}
      </div>
      <span class="plat" title="${st.track ? t("track", { track: esc(st.track) }) : ""}">${esc(st.track)}</span>
      <span class="expected">${expected}</span>
    </li>`;
}

const css = `
  ol.nr-board { --amber: #ffaa00; --dim: #b87a00; list-style: none; margin: 0; padding: 4px 10px; background: #000; color: var(--amber);
    border-radius: var(--border-radius-sm); overflow: hidden; letter-spacing: 0.02em; }
  ol.nr-board .train { display: grid; grid-template-columns: 3rem minmax(0, 1fr) 2rem 4.75rem; gap: 8px; align-items: start; padding: 6px 0;
    border-bottom: 1px dotted #3a2a00; cursor: pointer; }
  ol.nr-board .train:last-child { border-bottom: 0; }
  ol.nr-board .train:hover { background: #1a1200; }
  ol.nr-board .train.past > * { opacity: 0.5; }
  ol.nr-board .train.open { outline: 2px solid var(--amber); outline-offset: -2px; }
  ol.nr-board .time { font-weight: 700; font-variant-numeric: tabular-nums; }
  ol.nr-board .destination { min-width: 0; }
  ol.nr-board .name { display: flex; align-items: center; min-width: 0; font-weight: 700; }
  ol.nr-board .name > span:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ol.nr-board .calling, ol.nr-board .operator { color: var(--dim); font-size: 0.72rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ol.nr-board .calling:empty, ol.nr-board .operator:empty { display: none; }
  ol.nr-board .plat { font-weight: 700; text-align: center; white-space: nowrap; overflow: hidden; }
  ol.nr-board .expected { font-weight: 700; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ol.nr-board .expected > span:first-letter { text-transform: uppercase; }
  ol.nr-board .expected .theoretical { color: var(--dim); font-size: 0.7rem; font-weight: 400; }
  ol.nr-board .alert-mark, ol.nr-board .alert-line { color: var(--amber); }
  ol.nr-board .alert-mark.severe, ol.nr-board .alert-line.severe { color: #ff5a3c; }
  :root[data-display-mode="fullscreen"] ol.nr-board { font-size: 17px; }
  :root[data-display-mode="fullscreen"] ol.nr-board .train { grid-template-columns: 3.6rem minmax(0, 1fr) 2.5rem 5.75rem; padding: 8px 0; }
`;

/** British railway stations, not the bus, tram or Underground stops; the trains on the board. */
export const nationalRailBoard: CountryBoard = {
  className: "nr-board",
  matches: railwayStationIn("GB", "Europe/London"),
  onBoard: (st) => RAIL_MODES.has(st.mode),
  row,
  css,
};
