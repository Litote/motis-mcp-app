// Board of the Swiss railway stations, like the departure boards of the SBB stations: white on royal blue under the
// trilingual title "Départ Abfahrt Partenza", a line per train (pictogram of its category, time, a few stops then the
// destination, track) and the remarks in yellow (delays, cancellations).
import { esc, boardTime } from "../shared/format";
import { t } from "../shared/i18n";
import { RAIL_MODES } from "../shared/sncf";
import type { StopTimeDto } from "../shared/types";
import { delayOf, railwayStationIn, theoreticalMark, trainName, tripEnd, type BoardRow, type CountryBoard } from "./row";

/** Stops shown before the destination (all of them in the tooltip). */
const VIA_STOPS = 2;

/** Regional and S-Bahn trains: white pictogram; the others (RE, IR, IC, EC...) red. */
const REGIONAL_CATEGORY = /^(R|S|SN)\d*$/;

/** Pictogram of the category of the train ("IC" of "IC 727") or of its line ("S5", "IR36"), without its number. */
function pictogram(st: StopTimeDto): string {
  const category = trainName(st)?.category ?? st.line;
  const title = st.trainNumber ? ` title="${esc(st.line)} ${esc(st.trainNumber)}"` : "";
  return `<span class="piktogramm ${REGIONAL_CATEGORY.test(category) ? "" : "rot"}"${title}>${esc(category)}</span>`;
}

function row({ st, index, arriveBy, tz, classes, alertMark, alertLine, markTheoretical }: BoardRow): string {
  const end = tripEnd(st, arriveBy);
  // the stops next to the station: after it for a departure, before it for an arrival
  const near = arriveBy ? end.via.slice(-VIA_STOPS) : end.via.slice(0, VIA_STOPS);
  const delay = delayOf(st);
  let remark = "";
  if (st.cancelled) remark = `<span>${t("departures.cancelled")}</span>`;
  else if (delay > 0) remark = `<span title="${t("departures.expected", { time: boardTime(st.time, tz) })}">+${delay}'</span>`;
  else if (markTheoretical && !st.realTime) remark = theoreticalMark();
  return `
    <li class="train ${st.cancelled ? "deleted" : ""} ${classes}" data-index="${index}">
      <span class="kategorie">${pictogram(st)}</span>
      <span class="zeit">${boardTime(st.scheduledTime ?? st.time, tz)}</span>
      <div class="ziel">
        <div class="linie" title="${esc([...end.via.map((s) => s.name), end.label].join(" · "))}">
          <span class="via">${near.map((s) => esc(s.name)).join(" ")}</span><span class="nach">${esc(end.label)}</span>${alertMark}
        </div>
        ${alertLine}
      </div>
      <span class="gleis" title="${st.track ? t("track", { track: esc(st.track) }) : ""}">${esc(st.track)}</span>
      <span class="bemerkung">${remark}</span>
    </li>`;
}

/** The trilingual title of the boards, as at the stations whatever the language. */
const header = (arriveBy: boolean) =>
  `<li class="kopf" aria-hidden="true">${arriveBy ? "Arrivée Ankunft Arrivo" : "Départ Abfahrt Partenza"}</li>`;

const css = `
  ol.sbb-board { --blue: #2c4fa6; --rule: #1d3a85; --yellow: #f2e14b; list-style: none; margin: 0; padding: 0; background: var(--blue); color: #fff;
    border-radius: var(--border-radius-sm); overflow: hidden; }
  ol.sbb-board .kopf { padding: 3px 8px; background: var(--rule); color: #d5def5; font-size: 0.72rem; }
  ol.sbb-board .train { display: grid; grid-template-columns: 2.6rem 2.9rem minmax(0, 1fr) 2.6rem 4.5rem; gap: 6px; align-items: center;
    padding: 4px 8px; border-bottom: 1px solid var(--rule); cursor: pointer; }
  ol.sbb-board .train:last-child { border-bottom: 0; }
  ol.sbb-board .train:hover { background: #3459b3; }
  ol.sbb-board .train.past > * { opacity: 0.5; }
  ol.sbb-board .train.open { box-shadow: inset 0 0 0 3px var(--yellow); }
  ol.sbb-board .piktogramm { display: inline-block; min-width: 1.6rem; padding: 0 0.2rem; box-sizing: border-box; background: #fff; color: #000;
    font-size: 0.78rem; font-weight: 700; font-style: italic; text-align: center; white-space: nowrap; }
  ol.sbb-board .piktogramm.rot { background: #eb0000; color: #fff; }
  ol.sbb-board .zeit { font-variant-numeric: tabular-nums; }
  ol.sbb-board .ziel { min-width: 0; }
  ol.sbb-board .linie { display: flex; align-items: center; gap: 0.4em; min-width: 0; white-space: nowrap; }
  ol.sbb-board .via { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  ol.sbb-board .via:empty { display: none; }
  ol.sbb-board .nach { flex: none; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  ol.sbb-board .deleted .linie > span { text-decoration: line-through; }
  ol.sbb-board .gleis { text-align: center; white-space: nowrap; overflow: hidden; }
  ol.sbb-board .bemerkung { color: var(--yellow); font-size: 0.8rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ol.sbb-board .bemerkung .theoretical { color: #d5def5; font-size: 0.7rem; }
  ol.sbb-board .alert-mark, ol.sbb-board .alert-line { color: var(--yellow); }
  ol.sbb-board .alert-mark.severe, ol.sbb-board .alert-line.severe { color: #ff8a8a; }
  :root[data-display-mode="fullscreen"] ol.sbb-board { font-size: 17px; }
  :root[data-display-mode="fullscreen"] ol.sbb-board .train { grid-template-columns: 3rem 3.4rem minmax(0, 1fr) 3.2rem 6rem; padding: 6px 10px; }
`;

/** Swiss railway stations, not the bus or tram stops; the trains (with the S-Bahn) on the board. */
export const sbbBoard: CountryBoard = {
  className: "sbb-board",
  matches: railwayStationIn("CH", "Europe/Zurich"),
  onBoard: (st) => RAIL_MODES.has(st.mode),
  row,
  header,
  css,
};
