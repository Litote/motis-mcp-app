// Board of the Italian railway stations, like the arrivals & departures monitors of RFI: the column labels on a yellow
// band, the rows alternately pale yellow and dark grey, a line per train (brand, category, number, destination in
// capitals, time, delay, platform).
import { esc, time } from "../shared/format";
import { t } from "../shared/i18n";
import { RAIL_MODES } from "../shared/sncf";
import type { StopTimeDto } from "../shared/types";
import { delayOf, railwayStationIn, theoreticalMark, trainName, tripEnd, type BoardRow, type CountryBoard } from "./row";

/** Brands of the categories of trains: the Frecce of Trenitalia are high-speed (AV) trains. */
const BRANDS: Record<string, { brand: string; category?: string }> = {
  FR: { brand: "Frecciarossa", category: "AV" },
  FA: { brand: "Frecciargento", category: "AV" },
  FB: { brand: "Frecciabianca", category: "AV" },
  IC: { brand: "Intercity" },
  ICN: { brand: "Intercity Notte" },
  EC: { brand: "Trenitalia" },
  RV: { brand: "Regionale Veloce" },
  REG: { brand: "Regionale" },
  R: { brand: "Regionale" },
};

/** Brand (the agency without its own brand: "Trenord", "Italo"), category ("AV", "RE" of the line "RE2") and number. */
function trainColumns(st: StopTimeDto): { brand: string; category: string; number: string } {
  const tr = trainName(st);
  // the category of a line with a train number ("RE" of "RE2"), the line without it ("S5")
  const line = tr?.category ?? st.line;
  const category = tr?.number ? line.replace(/^([A-Za-z]+)\d+$/, "$1") : line;
  const known = /italo/i.test(st.agency) ? { brand: "Italo", category: "AV" } : BRANDS[category.toUpperCase()];
  const brand = known && !/trenord|tper|sad\b/i.test(st.agency) ? known.brand : st.agency;
  return { brand, category: known?.category ?? category, number: tr?.number ?? "" };
}

function row({ st, index, arriveBy, tz, classes, alertMark, alertLine, markTheoretical }: BoardRow): string {
  const end = tripEnd(st, arriveBy);
  const { brand, category, number } = trainColumns(st);
  const delay = delayOf(st);
  let ritardo = "";
  if (!st.cancelled && delay > 0) ritardo = `<span title="${t("departures.expected", { time: time(st.time, tz) })}">${delay}</span>`;
  else if (!st.cancelled && markTheoretical && !st.realTime) ritardo = theoreticalMark();
  const cancelled = st.cancelled ? `<span class="soppresso">${t("departures.cancelled")}</span>` : "";
  const stops = end.via.map((s) => s.name).join(" · ");
  return `
    <li class="train ${st.cancelled ? "deleted" : ""} ${classes}" data-index="${index}">
      <span class="impresa">${esc(brand)}</span>
      <span class="categoria">${esc(category)}</span>
      <span class="treno">${esc(number)}</span>
      <div class="per">
        <div class="nome" title="${esc(stops)}"><span>${esc(end.label)}</span>${alertMark}${cancelled}</div>
        ${alertLine}
      </div>
      <span class="orario">${time(st.scheduledTime ?? st.time, tz)}</span>
      <span class="ritardo">${ritardo}</span>
      <span class="binario" title="${st.track ? t("track", { track: esc(st.track) }) : ""}">${esc(st.track)}</span>
    </li>`;
}

/** Column labels, in Italian as on the monitors of the stations. */
const header = (arriveBy: boolean) => `
  <li class="intestazione" aria-hidden="true">
    <span class="impresa">Impresa</span><span>Categoria</span><span>Treno</span><span>${arriveBy ? "Da" : "Per"}</span>
    <span>Orario</span><span>Ritardo</span><span>Binario</span>
  </li>`;

const css = `
  ol.rfi-board { --yellow: #fcd700; --pale: #fde68e; --grey: #4a4a4a; list-style: none; margin: 0; padding: 0; background: #fff; color: #000;
    border-radius: var(--border-radius-sm); overflow: hidden; }
  ol.rfi-board > li { display: grid; grid-template-columns: 6.25rem 4.6rem 3.4rem minmax(0, 1fr) 3rem 3.4rem 3.4rem; gap: 6px; align-items: center; padding: 6px 8px; }
  ol.rfi-board .intestazione { background: var(--yellow); font-size: 0.8rem; font-weight: 700; }
  ol.rfi-board .intestazione > span { font-size: 0.8rem; font-style: normal; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ol.rfi-board .train { background: var(--grey); color: #fff; border-top: 2px solid #fff; cursor: pointer; }
  ol.rfi-board .train:nth-child(2n) { background: var(--pale); color: #000; }
  ol.rfi-board .train:hover { filter: brightness(1.08); }
  ol.rfi-board .train.past > * { opacity: 0.5; }
  ol.rfi-board .train.open { box-shadow: inset 0 0 0 3px #000; }
  ol.rfi-board .train:nth-child(2n + 1).open { box-shadow: inset 0 0 0 3px var(--yellow); }
  ol.rfi-board .impresa { font-size: 0.75rem; font-style: italic; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ol.rfi-board .categoria, ol.rfi-board .treno, ol.rfi-board .orario, ol.rfi-board .ritardo, ol.rfi-board .binario { font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; }
  ol.rfi-board .ritardo, ol.rfi-board .binario { text-align: center; }
  ol.rfi-board .per { min-width: 0; }
  ol.rfi-board .nome { display: flex; align-items: center; gap: 0.35rem; min-width: 0; text-transform: uppercase; }
  ol.rfi-board .nome > span:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ol.rfi-board .deleted .nome > span:first-child { text-decoration: line-through; }
  ol.rfi-board .soppresso { flex: none; padding: 0 0.3rem; background: #d6001c; color: #fff; font-size: 0.7rem; font-weight: 700; }
  ol.rfi-board .theoretical { color: inherit; opacity: 0.75; font-size: 0.65rem; }
  ol.rfi-board .alert-mark, ol.rfi-board .alert-line { color: inherit; }
  ol.rfi-board .alert-mark.severe, ol.rfi-board .alert-line.severe { color: #d6001c; }
  ol.rfi-board .train:nth-child(2n + 1) .alert-mark.severe, ol.rfi-board .train:nth-child(2n + 1) .alert-line.severe { color: #ff8a8a; }
  @media (max-width: 560px) {
    ol.rfi-board > li { grid-template-columns: 4.4rem 3rem minmax(0, 1fr) 2.9rem 3.2rem 3.2rem; }
    ol.rfi-board .impresa { display: none; }
  }
  :root[data-display-mode="fullscreen"] ol.rfi-board { font-size: 17px; }
  :root[data-display-mode="fullscreen"] ol.rfi-board > li { grid-template-columns: 9rem 4.5rem 4rem minmax(0, 1fr) 3.6rem 4rem 4.2rem; padding: 8px 10px; }
`;

/** Italian railway stations, not the bus, tram or metro stops; the trains on the board. */
export const rfiBoard: CountryBoard = {
  className: "rfi-board",
  matches: railwayStationIn("IT", "Europe/Rome"),
  onBoard: (st) => RAIL_MODES.has(st.mode),
  row,
  header,
  css,
};
