// Board of the Swiss railway stations, like the boards of the SBB stations: white on the dark blue of the SBB, the
// category of the train as a pictogram (red for the long-distance trains), the delays in yellow ("+5'").
import { esc, time } from "../shared/format";
import { t } from "../shared/i18n";
import { RAIL_MODES } from "../shared/sncf";
import type { StopTimeDto } from "../shared/types";
import { LONG_DISTANCE_MODES, delayOf, railwayStationIn, theoreticalMark, trainName, tripEnd, type BoardRow, type CountryBoard } from "./row";

/**
 * Pictogram of the train: its line ("S12", "IR36"), or its category and number ("IC 727") when the line is the
 * category alone.
 */
function zug(st: StopTimeDto): string {
  const tr = trainName(st);
  const category = tr?.category ?? st.line;
  const number = tr?.number && /^[A-Za-z]+$/.test(category) ? `<span class="nummer">${esc(tr.number)}</span>` : "";
  return `<span class="piktogramm ${LONG_DISTANCE_MODES.has(st.mode) ? "fern" : ""}">${esc(category)}</span>${number}`;
}

function row({ st, index, arriveBy, tz, classes, alertMark, alertLine, markTheoretical }: BoardRow): string {
  const end = tripEnd(st, arriveBy);
  const via = end.via.map((s) => esc(s.name)).join(" · ");
  const delay = delayOf(st);
  let status = "";
  if (st.cancelled) status = `<span class="ausfall">${t("departures.cancelled")}</span>`;
  else if (delay > 0) status = `<span class="verspaetung" title="${t("departures.expected", { time: time(st.time, tz) })}">+${delay}'</span>`;
  else if (markTheoretical && !st.realTime) status = theoreticalMark();
  return `
    <li class="train ${st.cancelled ? "deleted" : ""} ${classes}" data-index="${index}">
      <span class="zeit">${time(st.scheduledTime ?? st.time, tz)}</span>
      <span class="zug">${zug(st)}</span>
      <div class="nach">
        <div class="ziel"><span>${esc(end.label)}</span>${alertMark}${status}</div>
        <div class="via" title="${esc(via)}">${via}</div>
        ${alertLine}
      </div>
      <span class="gleis" title="${st.track ? t("track", { track: esc(st.track) }) : ""}">${esc(st.track)}</span>
    </li>`;
}

const css = `
  ol.sbb-board { --blue: #2d327d; --yellow: #ffde15; --red: #eb0000; list-style: none; margin: 0; padding: 0 8px; background: var(--blue); color: #fff;
    border-radius: var(--border-radius-sm); overflow: hidden; }
  ol.sbb-board .train { display: grid; grid-template-columns: 3rem 3.75rem minmax(0, 1fr) 3rem; gap: 8px; align-items: center; padding: 7px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.25); cursor: pointer; }
  ol.sbb-board .train:last-child { border-bottom: 0; }
  ol.sbb-board .train:hover { background: rgba(255, 255, 255, 0.08); }
  ol.sbb-board .train.past > * { opacity: 0.5; }
  ol.sbb-board .train.open { box-shadow: inset 0 0 0 3px var(--yellow); }
  ol.sbb-board .zeit { font-weight: 800; font-variant-numeric: tabular-nums; }
  ol.sbb-board .zug { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; }
  ol.sbb-board .piktogramm { max-width: 100%; padding: 0 0.3rem; border-radius: 2px; background: #fff; color: #000; font-size: 0.78rem; font-weight: 800;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ol.sbb-board .piktogramm.fern { background: var(--red); color: #fff; }
  ol.sbb-board .nummer { color: #c8cbe8; font-size: 0.7rem; font-variant-numeric: tabular-nums; }
  ol.sbb-board .nach { min-width: 0; }
  ol.sbb-board .ziel { display: flex; align-items: center; gap: 0.35rem; min-width: 0; font-weight: 700; }
  ol.sbb-board .ziel > span:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ol.sbb-board .deleted .ziel > span:first-child { text-decoration: line-through; }
  ol.sbb-board .via { margin-top: 1px; color: #c8cbe8; font-size: 0.72rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ol.sbb-board .via:empty { display: none; }
  ol.sbb-board .verspaetung { flex: none; color: var(--yellow); font-weight: 800; white-space: nowrap; }
  ol.sbb-board .ausfall { flex: none; padding: 0 0.3rem; background: var(--red); font-size: 0.72rem; font-weight: 700; white-space: nowrap; }
  ol.sbb-board .theoretical { flex: none; color: #c8cbe8; font-size: 0.7rem; font-weight: 400; white-space: nowrap; }
  ol.sbb-board .alert-mark, ol.sbb-board .alert-line { color: var(--yellow); }
  ol.sbb-board .alert-mark.severe, ol.sbb-board .alert-line.severe { color: #ff8080; }
  ol.sbb-board .gleis { font-size: 1.15em; font-weight: 800; text-align: right; white-space: nowrap; overflow: hidden; }
  :root[data-display-mode="fullscreen"] ol.sbb-board { font-size: 17px; }
  :root[data-display-mode="fullscreen"] ol.sbb-board .train { grid-template-columns: 3.6rem 4.5rem minmax(0, 1fr) 3.75rem; padding: 9px 0; }
`;

/** Swiss railway stations, not the bus or tram stops; the trains (with the S-Bahn) on the board. */
export const sbbBoard: CountryBoard = {
  className: "sbb-board",
  matches: railwayStationIn("Europe/Zurich"),
  onBoard: (st) => RAIL_MODES.has(st.mode),
  row,
  css,
};
