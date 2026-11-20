// Board of the Italian railway stations, like the monitors of the RFI stations: white capitals on dark blue, the
// columns Treno, Destinazione, Orario, Ritardo, Binario, the category of the train in the color of its brand.
import { esc, lineBadge, textOn, time } from "../shared/format";
import { t } from "../shared/i18n";
import { RAIL_MODES } from "../shared/sncf";
import type { StopTimeDto } from "../shared/types";
import { delayOf, railwayStationIn, theoreticalMark, trainName, tripEnd, type BoardRow, type CountryBoard } from "./row";

/** Category of a train ("FR", "IC", "RE" of the line "RE2") in the color of its route, and its number. */
function treno(st: StopTimeDto): string {
  const tr = trainName(st);
  // a line without train number (the S lines of the Milan passante): its badge
  if (!tr?.number) return lineBadge(st.mode, st.line, st.routeColor, st.routeTextColor, st.agency);
  const category = tr.category.replace(/^([A-Za-z]+)\d+$/, "$1");
  const style = st.routeColor ? ` style="background:${esc(st.routeColor)};color:${esc(textOn(st.routeColor, st.routeTextColor))}"` : "";
  return `<span class="categoria"${style}>${esc(category)}</span><span class="numero">${esc(tr.number)}</span>`;
}

function row({ st, index, arriveBy, tz, classes, alertMark, alertLine, markTheoretical }: BoardRow): string {
  const end = tripEnd(st, arriveBy);
  const via = end.via.map((s) => `${esc(s.name)} ${time(s.time, tz)}`).join(" · ");
  const delay = delayOf(st);
  let ritardo = "";
  if (st.cancelled) ritardo = `<span class="soppresso">${t("departures.cancelled")}</span>`;
  else if (delay > 0) ritardo = `<span title="${t("departures.expected", { time: time(st.time, tz) })}">${delay}'</span>`;
  else if (markTheoretical && !st.realTime) ritardo = theoreticalMark();
  return `
    <li class="train ${st.cancelled ? "deleted" : ""} ${classes}" data-index="${index}">
      <span class="treno">${treno(st)}</span>
      <div class="destinazione">
        <div class="nome"><span>${esc(end.label)}</span>${alertMark}</div>
        <div class="via" title="${esc(end.via.map((s) => s.name).join(" · "))}">${via}</div>
        ${alertLine}
      </div>
      <span class="orario">${time(st.scheduledTime ?? st.time, tz)}</span>
      <span class="ritardo">${ritardo}</span>
      <span class="binario" title="${st.track ? t("track", { track: esc(st.track) }) : ""}">${esc(st.track)}</span>
    </li>`;
}

const css = `
  ol.rfi-board { --blue: #0b2346; --line: rgba(255, 255, 255, 0.18); --yellow: #ffd200; list-style: none; margin: 0; padding: 0 8px;
    background: var(--blue); color: #fff; border-radius: var(--border-radius-sm); overflow: hidden; }
  ol.rfi-board .train { display: grid; grid-template-columns: 4.5rem minmax(0, 1fr) 3rem 3.25rem 3.5rem; gap: 8px; align-items: center;
    padding: 7px 0; border-bottom: 1px solid var(--line); cursor: pointer; }
  ol.rfi-board .train:last-child { border-bottom: 0; }
  ol.rfi-board .train:hover { background: rgba(255, 255, 255, 0.08); }
  ol.rfi-board .train.past > * { opacity: 0.5; }
  ol.rfi-board .train.open { box-shadow: inset 0 0 0 3px var(--yellow); }
  ol.rfi-board .treno { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; }
  ol.rfi-board .categoria { padding: 0 0.3rem; border-radius: 3px; background: #fff; color: var(--blue); font-size: 0.75rem; font-weight: 800; }
  ol.rfi-board .numero { font-size: 0.8rem; font-weight: 700; font-variant-numeric: tabular-nums; }
  ol.rfi-board .destinazione { min-width: 0; }
  ol.rfi-board .nome { display: flex; align-items: center; min-width: 0; font-weight: 700; text-transform: uppercase; }
  ol.rfi-board .nome > span:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ol.rfi-board .deleted .nome > span:first-child { text-decoration: line-through; }
  ol.rfi-board .via { margin-top: 1px; color: #c9d3e3; font-size: 0.72rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ol.rfi-board .via:empty { display: none; }
  ol.rfi-board .orario { font-weight: 800; font-variant-numeric: tabular-nums; }
  ol.rfi-board .ritardo { color: var(--yellow); font-weight: 800; text-align: center; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; overflow-wrap: anywhere; }
  ol.rfi-board .soppresso { display: inline-block; padding: 0 0.2rem; background: #d6001c; color: #fff; font-size: 0.6rem; text-transform: uppercase; }
  ol.rfi-board .theoretical { display: inline-block; color: #c9d3e3; font-size: 0.65rem; font-weight: 400; line-height: 1.1; white-space: normal; }
  ol.rfi-board .alert-mark, ol.rfi-board .alert-line { color: var(--yellow); }
  ol.rfi-board .alert-mark.severe, ol.rfi-board .alert-line.severe { color: #ff6b6b; }
  ol.rfi-board .binario { color: var(--yellow); font-size: 1.25em; font-weight: 800; text-align: right; white-space: nowrap; overflow: hidden; }
  :root[data-display-mode="fullscreen"] ol.rfi-board { font-size: 17px; }
  :root[data-display-mode="fullscreen"] ol.rfi-board .train { grid-template-columns: 5.5rem minmax(0, 1fr) 3.6rem 4rem 4.25rem; padding: 9px 0; }
`;

/** Italian railway stations, not the bus, tram or metro stops; the trains on the board. */
export const rfiBoard: CountryBoard = {
  className: "rfi-board",
  matches: railwayStationIn("Europe/Rome"),
  onBoard: (st) => RAIL_MODES.has(st.mode),
  row,
  css,
};
