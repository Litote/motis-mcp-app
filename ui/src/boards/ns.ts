// Board of the Dutch railway stations, like the departure screens of the NS stations: white on the blue of the NS,
// the columns Vertrek, Naar, Spoor, Trein, the track on the yellow of the NS, the delays next to the time ("+5").
import { esc, time } from "../shared/format";
import { t } from "../shared/i18n";
import { RAIL_MODES } from "../shared/sncf";
import { delayOf, railwayStationIn, theoreticalMark, trainName, tripEnd, type BoardRow, type CountryBoard } from "./row";

function row({ st, index, arriveBy, tz, classes, alertMark, alertLine, markTheoretical }: BoardRow): string {
  const end = tripEnd(st, arriveBy);
  const via = end.via.map((s) => esc(s.name)).join(", ");
  const delay = delayOf(st);
  const late = !st.cancelled && delay > 0 ? `<span class="vertraging" title="${t("departures.expected", { time: time(st.time, tz) })}">+${delay}</span>` : "";
  let status = "";
  if (st.cancelled) status = `<span class="rijdt-niet">${t("departures.cancelled")}</span>`;
  else if (markTheoretical && !st.realTime) status = theoreticalMark();
  // the type of train ("Intercity", "Sprinter", "ICE") and its operator
  const type = trainName(st)?.category ?? st.line;
  return `
    <li class="train ${st.cancelled ? "deleted" : ""} ${classes}" data-index="${index}">
      <span class="vertrek">${time(st.scheduledTime ?? st.time, tz)}${late}</span>
      <div class="naar">
        <div class="bestemming"><span>${esc(end.label)}</span>${alertMark}${status}</div>
        <div class="via" title="${esc(via)}">${via}</div>
        ${alertLine}
      </div>
      <span class="spoor ${st.track ? "" : "empty"}" title="${st.track ? t("track", { track: esc(st.track) }) : ""}">${esc(st.track)}</span>
      <span class="trein"><span>${esc(type)}</span><span class="vervoerder">${esc(st.agency)}</span></span>
    </li>`;
}

const css = `
  ol.ns-board { --blue: #003082; --yellow: #ffc917; list-style: none; margin: 0; padding: 0 8px; background: var(--blue); color: #fff;
    border-radius: var(--border-radius-sm); overflow: hidden; }
  ol.ns-board .train { display: grid; grid-template-columns: 3rem minmax(0, 1fr) 2.5rem 5rem; gap: 8px; align-items: center; padding: 7px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.2); cursor: pointer; }
  ol.ns-board .train:last-child { border-bottom: 0; }
  ol.ns-board .train:hover { background: rgba(255, 255, 255, 0.08); }
  ol.ns-board .train.past > * { opacity: 0.5; }
  ol.ns-board .train.open { box-shadow: inset 0 0 0 3px var(--yellow); }
  ol.ns-board .vertrek { display: flex; flex-direction: column; font-weight: 800; font-variant-numeric: tabular-nums; }
  ol.ns-board .vertraging { color: #ff7a6b; font-size: 0.75rem; }
  ol.ns-board .naar { min-width: 0; }
  ol.ns-board .bestemming { display: flex; align-items: center; gap: 0.35rem; min-width: 0; font-weight: 700; }
  ol.ns-board .bestemming > span:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ol.ns-board .deleted .bestemming > span:first-child { text-decoration: line-through; }
  ol.ns-board .via { margin-top: 1px; color: #c3cde6; font-size: 0.72rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ol.ns-board .via:empty { display: none; }
  ol.ns-board .rijdt-niet { flex: none; padding: 0 0.3rem; border-radius: 3px; background: #db0029; font-size: 0.72rem; font-weight: 700; white-space: nowrap; }
  ol.ns-board .theoretical { flex: none; color: #c3cde6; font-size: 0.7rem; font-weight: 400; white-space: nowrap; }
  ol.ns-board .alert-mark, ol.ns-board .alert-line { color: var(--yellow); }
  ol.ns-board .alert-mark.severe, ol.ns-board .alert-line.severe { color: #ff7a6b; }
  ol.ns-board .spoor { display: flex; align-items: center; justify-content: center; height: 2rem; border-radius: 4px; background: var(--yellow); color: var(--blue);
    font-size: 1.05rem; font-weight: 800; white-space: nowrap; overflow: hidden; }
  ol.ns-board .spoor.empty { background: transparent; }
  ol.ns-board .trein { display: flex; flex-direction: column; min-width: 0; font-size: 0.78rem; font-weight: 700; }
  ol.ns-board .trein > span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ol.ns-board .vervoerder { color: #c3cde6; font-size: 0.68rem; font-weight: 400; }
  :root[data-display-mode="fullscreen"] ol.ns-board { font-size: 17px; }
  :root[data-display-mode="fullscreen"] ol.ns-board .train { grid-template-columns: 3.6rem minmax(0, 1fr) 3rem 6.5rem; padding: 9px 0; }
  :root[data-display-mode="fullscreen"] ol.ns-board .spoor { height: 2.5rem; font-size: 1.3rem; }
`;

/** Dutch railway stations, not the bus, tram or metro stops; the trains on the board. */
export const nsBoard: CountryBoard = {
  className: "ns-board",
  matches: railwayStationIn("NL", "Europe/Amsterdam"),
  onBoard: (st) => RAIL_MODES.has(st.mode),
  row,
  css,
};
