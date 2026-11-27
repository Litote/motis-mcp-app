// Board of the French railway stations, like the ones of the SNCF stations (and of Carto Tchoo).
import { esc, lineBadge, boardTime } from "../shared/format";
import { t } from "../shared/i18n";
import { RAIL_MODES, linePictogram, train } from "../shared/sncf";
import type { StopTimeDto } from "../shared/types";
import { delayOf, railwayStationIn, theoreticalMark, tripEnd, type BoardRow, type CountryBoard } from "./row";

/** Logo of the brand (or brand name) of a train, or pictogram / badge of a line. */
function origin(st: StopTimeDto): string {
  const pictogram = linePictogram(st.mode, st.line, st.agency);
  if (pictogram) return `<span class="sncf-line ${st.line.startsWith("T") ? "tram" : ""}">${pictogram}</span>`;
  const tr = train(st.mode, st.line, st.agency, st.trainNumber);
  if (tr?.logo) return tr.logo;
  if (tr) return `<span class="brand">${esc(tr.brand)}</span>`;
  return lineBadge(st.mode, st.line, st.routeColor, st.routeTextColor, st.agency);
}

function row({ st, index, arriveBy, tz, classes, alertMark, alertLine, markTheoretical }: BoardRow): string {
  const number = train(st.mode, st.line, st.agency, st.trainNumber)?.number;
  // the end of the trip (origin of an arrival) is the big label: the intermediate stops are on the second line
  const { label, via: stops } = tripEnd(st, arriveBy);
  const via = stops.map((s) => `<span class="etape">${esc(s.name)} ${boardTime(s.time, tz)}</span>`).join(`<span class="point"> • </span>`);
  const delay = delayOf(st);
  let status = "";
  let state = "";
  if (st.cancelled) {
    status = `<span class="min deleted">${t("departures.cancelled")}</span>`;
    state = "deleted";
  } else if (delay > 0) {
    status = `<span class="min" title="${t("departures.expected", { time: boardTime(st.time, tz) })}">${t("departures.delay", { minutes: delay })}</span>`;
    state = "delayed";
  } else if (markTheoretical && !st.realTime) {
    status = theoreticalMark();
  }
  return `
    <li class="train ${state} ${classes}" data-index="${index}">
      <div class="lines">
        <div class="main-line">
          <span class="origine">${origin(st)}</span>
          <span class="numero">${esc(number)}</span>
          <span class="heure">${boardTime(st.scheduledTime ?? st.time, tz)}</span>
          <span class="station-label"><span>${esc(label)}</span>${alertMark}${status}</span>
        </div>
        <div class="second-line" title="${esc(stops.map((s) => s.name).join(" • "))}">${via}</div>
        ${alertLine}
      </div>
      <span class="platform ${st.track ? "" : "empty"}" title="${st.track ? t("track", { track: esc(st.track) }) : ""}">${esc(st.track)}</span>
    </li>`;
}

/** Colors of the SNCF boards: blue for the departures, green for the arrivals. */
const css = `
  ol.sncf-board { --bright: #356db9; --dark: #103e7d; list-style: none; margin: 0; padding: 0; background: var(--bright); color: #fff; border-radius: var(--border-radius-sm); overflow: hidden; }
  ol.sncf-board.arrivals { --bright: #24842b; --dark: #0d5f13; }
  ol.sncf-board .train { display: flex; align-items: center; gap: 8px; padding: 8px; cursor: pointer; }
  ol.sncf-board .train:nth-child(2n) { background: var(--dark); }
  ol.sncf-board .train.deleted { background: #b93535; }
  ol.sncf-board .train:hover { filter: brightness(1.15); }
  ol.sncf-board .train.past > * { opacity: 0.5; }
  ol.sncf-board .lines { flex: 1; min-width: 0; }
  ol.sncf-board .main-line { display: flex; align-items: center; min-width: 0; }
  ol.sncf-board .origine { flex: none; width: 2.5rem; display: flex; align-items: center; font-size: 0.55rem; font-weight: 700; text-transform: uppercase; overflow: hidden; }
  ol.sncf-board .origine > svg { max-width: 2.5rem; max-height: 1.25rem; width: 2.5rem; }
  ol.sncf-board .origine .brand { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ol.sncf-board .origine .sncf-line svg { width: 1.25rem; height: 1.25rem; }
  ol.sncf-board .numero { flex: none; width: 3.5rem; padding-right: 0.5rem; text-align: right; font-size: 0.7rem; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ol.sncf-board .heure { flex: none; width: 3rem; color: #fe0; font-weight: 900; font-variant-numeric: tabular-nums; }
  ol.sncf-board .station-label { display: flex; align-items: center; gap: 0.25rem; min-width: 0; font-weight: 700; }
  ol.sncf-board .station-label > span:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ol.sncf-board .min { flex: none; padding: 0.1rem 0.25rem; border-radius: 4px; background: #ff7300; font-size: 0.7rem; font-weight: 700; white-space: nowrap; }
  ol.sncf-board .min.deleted { background: #ff2e00; }
  ol.sncf-board .theoretical { flex: none; color: #cdd5e0; font-size: 0.7rem; font-weight: 400; white-space: nowrap; }
  ol.sncf-board .second-line { margin-top: 2px; font-size: 0.7rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ol.sncf-board .second-line:empty { display: none; }
  ol.sncf-board .alert-line { color: #fe0; font-size: 0.7rem; }
  ol.sncf-board .platform { flex: none; display: flex; align-items: center; justify-content: center; min-width: 2rem; height: 2rem; padding: 0 0.1rem; box-sizing: border-box; border: 2px solid #eee; border-radius: 4px; background: #eee; color: #333; font-size: 1.25rem; font-weight: 700; white-space: nowrap; }
  ol.sncf-board .platform.empty { background: transparent; border-color: transparent; }
  ol.sncf-board .deleted .platform { color: #ff5c5c; }
  ol.sncf-board .train.open { box-shadow: inset 0 0 0 3px #fe0; }
  :root[data-display-mode="fullscreen"] ol.sncf-board { font-size: 17px; }
  :root[data-display-mode="fullscreen"] ol.sncf-board .train { padding: 10px; }
  :root[data-display-mode="fullscreen"] ol.sncf-board .heure { width: 3.6rem; font-size: 1.3em; }
  :root[data-display-mode="fullscreen"] ol.sncf-board .platform { min-width: 2.5rem; height: 2.5rem; font-size: 1.5rem; }
`;

/** French railway stations, not the bus or metro stops; the trains and Île-de-France trams on the board. */
export const sncfBoard: CountryBoard = {
  className: "sncf-board",
  matches: railwayStationIn("FR", "Europe/Paris"),
  onBoard: (st) => RAIL_MODES.has(st.mode) || linePictogram(st.mode, st.line, st.agency) !== null,
  row,
  css,
};
