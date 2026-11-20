// Board of the Spanish railway stations, like the boards of the Adif stations: the bilingual title "Salidas
// DEPARTURES" on a dark band, the bilingual column labels in green, then on cream a line per train: time on a green
// column, destination in capitals, operator and product ("renfe" over "AVE"), number, platform, remarks in orange.
import { esc, lineBadge, time } from "../shared/format";
import { t } from "../shared/i18n";
import { RAIL_MODES } from "../shared/sncf";
import type { StopTimeDto } from "../shared/types";
import { delayOf, railwayStationIn, theoreticalMark, trainName, tripEnd, type BoardRow, type CountryBoard } from "./row";

/** Operators written with their color (class), over the product of the train. */
const OPERATORS = ["renfe", "ouigo", "iryo"];

/** Operator and product of a train ("renfe" over "AVE"); the badge of a Cercanías / Rodalies line. */
function tren(st: StopTimeDto): string {
  const tr = trainName(st);
  if (!tr?.number) return lineBadge(st.mode, st.line, st.routeColor, st.routeTextColor, st.agency);
  const operator = OPERATORS.find((name) => st.agency.toLowerCase().includes(name));
  const name = operator ? `<span class="operador ${operator}">${operator}</span>` : `<span class="operador">${esc(st.agency)}</span>`;
  // the product, unless it is the operator ("OUIGO 06231")
  const product = operator && tr.category.toLowerCase() === operator ? "" : `<span class="producto">${esc(tr.category)}</span>`;
  return name + product;
}

function row({ st, index, arriveBy, tz, classes, alertMark, alertLine, markTheoretical }: BoardRow): string {
  const end = tripEnd(st, arriveBy);
  const delay = delayOf(st);
  let observaciones = "";
  if (st.cancelled) observaciones = `<span class="cancelado">${t("departures.cancelled")}</span>`;
  else if (delay > 0)
    observaciones = `<span class="retraso" title="${t("departures.expected", { time: time(st.time, tz) })}">${t("departures.delay", { minutes: delay })}</span>`;
  else if (markTheoretical && !st.realTime) observaciones = theoreticalMark();
  const stops = end.via.map((s) => s.name).join(", ");
  return `
    <li class="train ${st.cancelled ? "deleted" : ""} ${classes}" data-index="${index}">
      <span class="hora">${time(st.scheduledTime ?? st.time, tz)}</span>
      <div class="destino">
        <div class="nombre" title="${esc(stops)}"><span>${esc(end.label)}</span>${alertMark}</div>
        ${alertLine}
      </div>
      <span class="tren">${tren(st)}</span>
      <span class="numero">${esc(trainName(st)?.number)}</span>
      <span class="via" title="${st.track ? t("track", { track: esc(st.track) }) : ""}">${esc(st.track)}</span>
      <span class="observaciones">${observaciones}</span>
    </li>`;
}

/** Bilingual title and column labels, in Spanish and English as on the boards of the stations. */
const header = (arriveBy: boolean) => {
  const label = (es: string, en: string, cls = "") => `<span class="${cls}">${es}<small>${en}</small></span>`;
  return `
    <li class="titulo" aria-hidden="true">${arriveBy ? "Llegadas <small>ARRIVALS</small>" : "Salidas <small>DEPARTURES</small>"}</li>
    <li class="columnas" aria-hidden="true">
      ${label("Hora", "TIME")}${label(arriveBy ? "Procedencia" : "Destino", arriveBy ? "ORIGIN" : "DESTINATION")}${label("Tren", "TRAIN")}
      ${label("Número", "NUMBER", "numero")}${label("Vía", "PLATFORM")}${label("Observaciones", "OBSERVATIONS")}
    </li>`;
};

const css = `
  ol.adif-board { --green: #2f8f3a; --cream: #f7f5df; list-style: none; margin: 0; padding: 0; background: var(--cream); color: #111;
    border-radius: var(--border-radius-sm); overflow: hidden; }
  ol.adif-board .titulo { padding: 6px 10px; background: #262626; color: #fff; font-size: 1.15rem; }
  ol.adif-board .titulo small { margin-left: 0.4rem; padding-left: 0.5rem; border-left: 1px solid #888; font-size: 0.75rem; letter-spacing: 0.05em; }
  ol.adif-board .columnas, ol.adif-board .train { display: grid; grid-template-columns: 3.4rem minmax(0, 1fr) 4.4rem 3.4rem 3rem 6rem; gap: 8px; align-items: center; }
  ol.adif-board .columnas { padding: 4px 8px 4px 0; color: var(--green); font-size: 0.78rem; font-weight: 700; line-height: 1.1; }
  ol.adif-board .columnas > span { display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
  ol.adif-board .columnas > span:first-child { padding-left: 8px; }
  /* train, number and platform centered, as their values */
  ol.adif-board .columnas > span:nth-child(n + 3):nth-child(-n + 5) { align-items: center; }
  ol.adif-board .columnas small { font-size: 0.55rem; font-weight: 400; letter-spacing: 0.04em; }
  ol.adif-board .train { padding: 0 8px 0 0; border-top: 1px solid #d8d4b0; cursor: pointer; }
  ol.adif-board .train:hover { background: #efecc8; }
  ol.adif-board .train.past > * { opacity: 0.5; }
  ol.adif-board .train.open { box-shadow: inset 0 0 0 3px var(--green); }
  ol.adif-board .hora { align-self: stretch; display: flex; align-items: center; padding: 6px 8px; background: var(--green); color: #fff; font-weight: 800;
    font-variant-numeric: tabular-nums; }
  ol.adif-board .destino { min-width: 0; padding: 6px 0; }
  ol.adif-board .nombre { display: flex; align-items: center; min-width: 0; font-weight: 800; text-transform: uppercase; }
  ol.adif-board .nombre > span:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ol.adif-board .deleted .nombre > span:first-child { text-decoration: line-through; }
  ol.adif-board .tren { display: flex; flex-direction: column; align-items: center; min-width: 0; line-height: 1.05; }
  ol.adif-board .operador { max-width: 100%; color: #555; font-size: 0.8rem; font-weight: 800; font-style: italic; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ol.adif-board .operador.renfe { color: #8a1a77; }
  ol.adif-board .operador.ouigo { color: #e6007e; }
  ol.adif-board .operador.iryo { color: #c8102e; }
  ol.adif-board .producto { color: #8a1a77; font-size: 0.68rem; font-style: italic; }
  ol.adif-board .numero { font-variant-numeric: tabular-nums; text-align: center; white-space: nowrap; overflow: hidden; }
  ol.adif-board .via { font-size: 1.2em; font-weight: 800; text-align: center; white-space: nowrap; overflow: hidden; }
  ol.adif-board .observaciones { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ol.adif-board .retraso { color: #e2700c; }
  ol.adif-board .cancelado { color: #d6001c; }
  ol.adif-board .theoretical { color: #777; font-size: 0.68rem; font-weight: 400; text-transform: none; }
  ol.adif-board .alert-mark, ol.adif-board .alert-line { color: #e2700c; }
  ol.adif-board .alert-mark.severe, ol.adif-board .alert-line.severe { color: #d6001c; }
  @media (max-width: 560px) {
    ol.adif-board .columnas, ol.adif-board .train { grid-template-columns: 3.4rem minmax(0, 1fr) 4rem 3rem 4.6rem; }
    ol.adif-board .numero { display: none; }
  }
  :root[data-display-mode="fullscreen"] ol.adif-board { font-size: 17px; }
  :root[data-display-mode="fullscreen"] ol.adif-board .columnas, :root[data-display-mode="fullscreen"] ol.adif-board .train {
    grid-template-columns: 4rem minmax(0, 1fr) 5.2rem 4rem 3rem 8rem; }
`;

/** Spanish railway stations, not the bus or metro stops; the trains (with the Cercanías) on the board. */
export const adifBoard: CountryBoard = {
  className: "adif-board",
  matches: railwayStationIn("Europe/Madrid"),
  onBoard: (st) => RAIL_MODES.has(st.mode),
  row,
  header,
  css,
};
