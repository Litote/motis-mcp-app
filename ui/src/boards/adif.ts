// Board of the Spanish railway stations, like the screens of the Adif stations: white on black, the columns Hora,
// Destino, Tren, Vía, the products of Renfe on its purple, the Cercanías / Rodalies lines in their colors.
import { esc, lineBadge, time } from "../shared/format";
import { t } from "../shared/i18n";
import { RAIL_MODES } from "../shared/sncf";
import type { StopTimeDto } from "../shared/types";
import { delayOf, railwayStationIn, theoreticalMark, trainName, tripEnd, type BoardRow, type CountryBoard } from "./row";

/** Operators with a color of their own (class of the product). */
const OPERATORS = ["renfe", "ouigo", "iryo"];

/** Product of a train ("AVE", "Alvia"...) on the color of its operator, and its number; the badge of a commuter line. */
function tren(st: StopTimeDto): string {
  const tr = trainName(st);
  if (!tr?.number) return lineBadge(st.mode, st.line, st.routeColor, st.routeTextColor, st.agency);
  const operator = OPERATORS.find((name) => st.agency.toLowerCase().includes(name)) ?? "";
  return `<span class="producto ${operator}">${esc(tr.category)}</span><span class="numero">${esc(tr.number)}</span>`;
}

function row({ st, index, arriveBy, tz, classes, alertMark, alertLine, markTheoretical }: BoardRow): string {
  const end = tripEnd(st, arriveBy);
  const via = end.via.map((s) => esc(s.name)).join(", ");
  const delay = delayOf(st);
  let observaciones = "";
  if (st.cancelled) observaciones = `<span class="cancelado">${t("departures.cancelled")}</span>`;
  else if (delay > 0)
    observaciones = `<span class="retraso" title="${t("departures.expected", { time: time(st.time, tz) })}">${t("departures.delay", { minutes: delay })}</span>`;
  else if (markTheoretical && !st.realTime) observaciones = theoreticalMark();
  return `
    <li class="train ${st.cancelled ? "deleted" : ""} ${classes}" data-index="${index}">
      <span class="hora">${time(st.scheduledTime ?? st.time, tz)}</span>
      <div class="destino">
        <div class="nombre"><span>${esc(end.label)}</span>${alertMark}${observaciones}</div>
        <div class="via" title="${esc(via)}">${via}</div>
        ${alertLine}
      </div>
      <span class="tren">${tren(st)}</span>
      <span class="via-anden" title="${st.track ? t("track", { track: esc(st.track) }) : ""}">${esc(st.track)}</span>
    </li>`;
}

const css = `
  ol.adif-board { --amber: #ffb81c; list-style: none; margin: 0; padding: 0 8px; background: #050505; color: #fff;
    border-radius: var(--border-radius-sm); overflow: hidden; }
  ol.adif-board .train { display: grid; grid-template-columns: 3rem minmax(0, 1fr) 4.5rem 2rem; gap: 8px; align-items: center;
    padding: 7px 0; border-bottom: 1px solid #2a2a2a; cursor: pointer; }
  ol.adif-board .train:nth-child(2n) { background: #141414; box-shadow: -8px 0 0 #141414, 8px 0 0 #141414; }
  ol.adif-board .train:last-child { border-bottom: 0; }
  ol.adif-board .train:hover { background: #222; box-shadow: -8px 0 0 #222, 8px 0 0 #222; }
  ol.adif-board .train.past > * { opacity: 0.5; }
  ol.adif-board .train.open { outline: 3px solid var(--amber); outline-offset: -3px; }
  ol.adif-board .hora { color: var(--amber); font-weight: 800; font-variant-numeric: tabular-nums; }
  ol.adif-board .destino { min-width: 0; }
  ol.adif-board .nombre { display: flex; align-items: center; gap: 0.3rem; min-width: 0; font-weight: 700; }
  ol.adif-board .nombre > span:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ol.adif-board .deleted .nombre > span:first-child { text-decoration: line-through; }
  ol.adif-board .via { margin-top: 1px; color: #aaa; font-size: 0.72rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ol.adif-board .via:empty { display: none; }
  ol.adif-board .tren { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; }
  ol.adif-board .producto { max-width: 100%; padding: 0 0.3rem; border-radius: 3px; background: #444; color: #fff; font-size: 0.72rem; font-weight: 800;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ol.adif-board .producto.renfe { background: #8a1a77; }
  ol.adif-board .producto.ouigo { background: #e6007e; }
  ol.adif-board .producto.iryo { background: #c8102e; }
  ol.adif-board .numero { color: #ccc; font-size: 0.72rem; font-variant-numeric: tabular-nums; }
  ol.adif-board .retraso { flex: none; color: var(--amber); font-size: 0.75rem; font-weight: 700; white-space: nowrap; }
  ol.adif-board .cancelado { flex: none; padding: 0 0.3rem; background: #d6001c; font-size: 0.72rem; font-weight: 700; white-space: nowrap; }
  ol.adif-board .theoretical { flex: none; color: #aaa; font-size: 0.7rem; font-weight: 400; white-space: nowrap; }
  ol.adif-board .alert-mark, ol.adif-board .alert-line { color: var(--amber); }
  ol.adif-board .alert-mark.severe, ol.adif-board .alert-line.severe { color: #ff6b6b; }
  ol.adif-board .via-anden { color: var(--amber); font-size: 1.2em; font-weight: 800; text-align: right; white-space: nowrap; overflow: hidden; }
  :root[data-display-mode="fullscreen"] ol.adif-board { font-size: 17px; }
  :root[data-display-mode="fullscreen"] ol.adif-board .train { grid-template-columns: 3.6rem minmax(0, 1fr) 5.5rem 2.5rem; padding: 9px 0; }
`;

/** Spanish railway stations, not the bus or metro stops; the trains (with the Cercanías) on the board. */
export const adifBoard: CountryBoard = {
  className: "adif-board",
  matches: railwayStationIn("Europe/Madrid"),
  onBoard: (st) => RAIL_MODES.has(st.mode),
  row,
  css,
};
