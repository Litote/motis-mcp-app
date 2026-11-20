// Board of the Belgian railway stations, like the screens of the SNCB / NMBS stations: white on the blue of the SNCB,
// the delays in yellow ("+5'"), the cancellations in red.
import { esc, lineBadge, time } from "../shared/format";
import { t } from "../shared/i18n";
import { RAIL_MODES } from "../shared/sncf";
import type { StopTimeDto } from "../shared/types";
import { delayOf, railwayStationIn, theoreticalMark, trainName, tripEnd, type BoardRow, type CountryBoard } from "./row";

/** Type and number of a train ("IC" 1935), the badge of an S line in its color. */
function trein(st: StopTimeDto): string {
  const tr = trainName(st);
  if (st.mode === "SUBURBAN" || !tr?.number) return lineBadge(st.mode, st.line, st.routeColor, st.routeTextColor, st.agency);
  return `<span class="type">${esc(tr.category)}</span><span class="numero">${esc(tr.number)}</span>`;
}

function row({ st, index, arriveBy, tz, classes, alertMark, alertLine, markTheoretical }: BoardRow): string {
  const end = tripEnd(st, arriveBy);
  const via = end.via.map((s) => esc(s.name)).join(" – ");
  const delay = delayOf(st);
  let remark = "";
  if (st.cancelled) remark = `<span class="supprime">${t("departures.cancelled")}</span>`;
  else if (delay > 0) remark = `<span class="retard" title="${t("departures.expected", { time: time(st.time, tz) })}">+${delay}'</span>`;
  else if (markTheoretical && !st.realTime) remark = theoreticalMark();
  return `
    <li class="train ${st.cancelled ? "deleted" : ""} ${classes}" data-index="${index}">
      <span class="heure">${time(st.scheduledTime ?? st.time, tz)}</span>
      <span class="trein">${trein(st)}</span>
      <div class="destination">
        <div class="nom"><span>${esc(end.label)}</span>${alertMark}${remark}</div>
        <div class="via" title="${esc(via)}">${via}</div>
        ${alertLine}
      </div>
      <span class="voie ${st.track ? "" : "empty"}" title="${st.track ? t("track", { track: esc(st.track) }) : ""}">${esc(st.track)}</span>
    </li>`;
}

const css = `
  ol.sncb-board { --blue: #003a8c; --dark: #002c6b; --yellow: #ffd500; list-style: none; margin: 0; padding: 0; background: var(--blue); color: #fff;
    border-radius: var(--border-radius-sm); overflow: hidden; }
  ol.sncb-board .train { display: grid; grid-template-columns: 3rem 3.25rem minmax(0, 1fr) 2.25rem; gap: 8px; align-items: center; padding: 7px 8px; cursor: pointer; }
  ol.sncb-board .train:nth-child(2n) { background: var(--dark); }
  ol.sncb-board .train:hover { filter: brightness(1.2); }
  ol.sncb-board .train.past > * { opacity: 0.5; }
  ol.sncb-board .train.open { box-shadow: inset 0 0 0 3px var(--yellow); }
  ol.sncb-board .heure { font-weight: 800; font-variant-numeric: tabular-nums; }
  ol.sncb-board .trein { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; }
  ol.sncb-board .type { max-width: 100%; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ol.sncb-board .numero { color: #c7d5ef; font-size: 0.7rem; font-variant-numeric: tabular-nums; }
  ol.sncb-board .destination { min-width: 0; }
  ol.sncb-board .nom { display: flex; align-items: center; gap: 0.35rem; min-width: 0; font-weight: 700; }
  ol.sncb-board .nom > span:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ol.sncb-board .deleted .nom > span:first-child { text-decoration: line-through; }
  ol.sncb-board .via { margin-top: 1px; color: #c7d5ef; font-size: 0.72rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ol.sncb-board .via:empty { display: none; }
  ol.sncb-board .retard { flex: none; color: var(--yellow); font-weight: 800; white-space: nowrap; }
  ol.sncb-board .supprime { flex: none; padding: 0 0.3rem; border-radius: 3px; background: #e2001a; font-size: 0.72rem; font-weight: 700; white-space: nowrap; }
  ol.sncb-board .theoretical { flex: none; color: #c7d5ef; font-size: 0.7rem; font-weight: 400; white-space: nowrap; }
  ol.sncb-board .alert-mark, ol.sncb-board .alert-line { color: var(--yellow); }
  ol.sncb-board .alert-mark.severe, ol.sncb-board .alert-line.severe { color: #ff7b7b; }
  ol.sncb-board .voie { display: flex; align-items: center; justify-content: center; height: 2rem; border-radius: 4px; background: #fff; color: var(--blue);
    font-size: 1.15rem; font-weight: 800; white-space: nowrap; overflow: hidden; }
  ol.sncb-board .voie.empty { background: transparent; }
  :root[data-display-mode="fullscreen"] ol.sncb-board { font-size: 17px; }
  :root[data-display-mode="fullscreen"] ol.sncb-board .train { grid-template-columns: 3.6rem 4rem minmax(0, 1fr) 2.75rem; padding: 9px 10px; }
  :root[data-display-mode="fullscreen"] ol.sncb-board .voie { height: 2.5rem; font-size: 1.4rem; }
`;

/** Belgian railway stations, not the bus, tram or metro stops; the trains (with the S lines) on the board. */
export const sncbBoard: CountryBoard = {
  className: "sncb-board",
  matches: railwayStationIn("BE", "Europe/Brussels"),
  onBoard: (st) => RAIL_MODES.has(st.mode),
  row,
  css,
};
