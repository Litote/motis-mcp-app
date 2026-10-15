// Departures board (departures) and trip timeline (trip_details).
import { callTool, startView, type Args } from "./shared/app";
import { day, delayBadge, delayMinutes, duration, esc, lineBadge, time } from "./shared/format";
import { t } from "./shared/i18n";
import { RAIL_MODES, linePictogram, train } from "./shared/sncf";
import type { DeparturesResult, PlaceDto, StopTimeDto, TripResult } from "./shared/types";

type BoardData = DeparturesResult | TripResult;

const title = document.getElementById("title")!;
const subtitle = document.getElementById("subtitle")!;
const content = document.getElementById("content")!;

const history: BoardData[] = [];
let current: BoardData | null = null;
/** Arguments of the departures call, reused for paging and the arrivals toggle. */
let boardArgs: Args = {};

const app = startView("MOTIS departures", {
  render: (data, args) => {
    if (data.kind === "departures") boardArgs = { ...args, pageCursor: undefined };
    history.length = 0;
    show(data as unknown as BoardData, false);
  },
});

function show(data: BoardData, push: boolean): void {
  if (push && current) history.push(current);
  current = data;
  if (data.kind === "trip") renderTrip(data);
  else renderBoard(data);
}

/** Time with its delay: "08:12 +3" in red, or green when on time in real time. */
function timeCell(actual: string | undefined, scheduled: string | undefined, realTime: boolean, tz?: string): string {
  const delay = delayMinutes(actual, scheduled);
  if (!realTime) return `<span>${time(scheduled ?? actual, tz)}</span>`;
  if (delay === 0) return `<span class="on-time" title="${t("departures.realTime")}">${time(actual, tz)}</span>`;
  const sign = delay > 0 ? "+" : "";
  return `<span class="late" title="${t("departures.scheduled", { time: time(scheduled, tz) })}"><s class="muted">${time(scheduled, tz)}</s> ${time(actual, tz)} (${sign}${delay})</span>`;
}

/** French railway stations get a board like the ones of the SNCF stations (and of Carto Tchoo): not the bus or metro stops. */
function isFrenchStation(data: DeparturesResult): boolean {
  const trains = data.stopTimes.filter((st) => RAIL_MODES.has(st.mode)).length;
  return data.stop.tz === "Europe/Paris" && trains > 0 && trains * 2 >= data.stopTimes.length;
}

/** Logo of the brand (or brand name) of a train, or pictogram / badge of a line. */
function sncfOrigin(st: StopTimeDto): string {
  const pictogram = linePictogram(st.mode, st.line, st.agency);
  if (pictogram) return `<span class="sncf-line ${st.line.startsWith("T") ? "tram" : ""}">${pictogram}</span>`;
  const tr = train(st.mode, st.line, st.agency, st.trainNumber);
  if (tr?.logo) return tr.logo;
  if (tr) return `<span class="brand">${esc(tr.brand)}</span>`;
  return lineBadge(st.mode, st.line, st.routeColor, st.routeTextColor, st.agency);
}

function sncfRow(st: StopTimeDto, index: number, arriveBy: boolean, tz?: string): string {
  const number = train(st.mode, st.line, st.agency, st.trainNumber)?.number;
  // the end of the trip (origin of an arrival) is the big label: the intermediate stops are on the second line
  const stops = arriveBy ? (st.stops ?? []).slice(1) : (st.stops ?? []).slice(0, -1);
  const label = (arriveBy ? st.stops?.[0] : st.stops?.at(-1))?.name ?? st.headsign;
  const via = stops.map((s) => `<span class="etape">${esc(s.name)} ${time(s.time, tz)}</span>`).join(`<span class="point"> • </span>`);
  const delay = st.realTime ? delayMinutes(st.time, st.scheduledTime) : 0;
  let status = "";
  let state = "";
  if (st.cancelled) {
    status = `<span class="min deleted">${t("departures.cancelled")}</span>`;
    state = "deleted";
  } else if (delay > 0) {
    status = `<span class="min" title="${t("departures.expected", { time: time(st.time, tz) })}">${t("departures.delay", { minutes: delay })}</span>`;
    state = "delayed";
  }
  return `
    <li class="train ${state}" data-index="${index}">
      <div class="lines">
        <div class="main-line">
          <span class="origine">${sncfOrigin(st)}</span>
          <span class="numero">${esc(number)}</span>
          <span class="heure">${time(st.scheduledTime ?? st.time, tz)}</span>
          <span class="station-label"><span>${esc(label)}</span>${status}</span>
        </div>
        <div class="second-line" title="${esc(stops.map((s) => s.name).join(" • "))}">${via}</div>
      </div>
      <span class="platform ${st.track ? "" : "empty"}" title="${st.track ? t("track", { track: esc(st.track) }) : ""}">${esc(st.track)}</span>
    </li>`;
}

function renderBoard(data: DeparturesResult): void {
  const tz = data.stop.tz;
  title.textContent = data.stop.name;
  const first = data.stopTimes[0]?.time;
  const firstDay = first ? ` · ${day(first, tz)}` : "";
  subtitle.textContent = `${t(data.arriveBy ? "departures.arrivals" : "departures.departures")}${firstDay}`;
  if (isFrenchStation(data)) {
    const trains = data.stopTimes.map((st, i) => sncfRow(st, i, data.arriveBy, tz)).join("");
    renderToolbarAnd(data, `<ol class="sncf-board ${data.arriveBy ? "arrivals" : ""}">${trains}</ol>`);
    return;
  }
  const rows = data.stopTimes
    .map(
      (st, i) => `
      <tr class="clickable" data-index="${i}">
        <td class="${st.cancelled ? "cancelled" : ""}">${timeCell(st.time, st.scheduledTime, st.realTime, tz)}</td>
        <td>${lineBadge(st.mode, st.line, st.routeColor, st.routeTextColor)}</td>
        <td>${esc(st.headsign)}${st.cancelled ? ` <strong class="late">${t("departures.cancelled")}</strong>` : ""}<div class="muted">${esc(st.agency)}</div></td>
        <td class="muted">${st.track ? t("track", { track: esc(st.track) }) : ""}</td>
      </tr>`,
    )
    .join("");
  const board = rows ? `<table class="board"><tbody>${rows}</tbody></table>` : `<p class="muted">${t("departures.none")}</p>`;
  renderToolbarAnd(data, board);
}

/** Paging and departures / arrivals buttons, then the [board]. */
function renderToolbarAnd(data: DeparturesResult, board: string): void {
  content.innerHTML = `
    <div class="toolbar">
      <button type="button" data-action="previous" ${data.previousPageCursor ? "" : "disabled"}>${t("earlier")}</button>
      <button type="button" data-action="next" ${data.nextPageCursor ? "" : "disabled"}>${t("later")}</button>
      <span style="flex:1"></span>
      <button type="button" data-action="departures" aria-pressed="${!data.arriveBy}">${t("departures.departures")}</button>
      <button type="button" data-action="arrivals" aria-pressed="${data.arriveBy}">${t("departures.arrivals")}</button>
    </div>
    ${board}`;

  content.querySelectorAll<HTMLElement>("[data-index]").forEach((tr) =>
    tr.addEventListener("click", () => openTrip(data.stopTimes[Number(tr.dataset.index)].tripId)),
  );
  content.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((button) =>
    button.addEventListener("click", () => {
      const action = button.dataset.action;
      if (action === "previous") void reload({ pageCursor: data.previousPageCursor });
      else if (action === "next") void reload({ pageCursor: data.nextPageCursor });
      else void reload({ arriveBy: action === "arrivals", pageCursor: undefined });
    }),
  );
}

async function reload(changes: Args): Promise<void> {
  const { pageCursor, ...rest } = changes;
  boardArgs = { ...boardArgs, ...rest, stopId: boardArgs.stopId ?? (current?.kind === "departures" ? current.stop.stopId : undefined) };
  try {
    show(await callTool<DeparturesResult>(app, "departures", { ...boardArgs, pageCursor }), false);
  } catch {
    // reported in the status bar
  }
}

async function openTrip(tripId: string): Promise<void> {
  try {
    show(await callTool<TripResult>(app, "trip_details", { tripId }), true);
  } catch {
    // reported in the status bar
  }
}

function stopRow(stop: PlaceDto, color: string, isEnd: boolean): string {
  const arrival = stop.arrival ?? stop.scheduledArrival;
  const departure = stop.departure ?? stop.scheduledDeparture;
  const actual = departure ?? arrival;
  const scheduled = departure ? stop.scheduledDeparture : stop.scheduledArrival;
  const delay = delayMinutes(actual, scheduled);
  const track = stop.track ? ` <span class="muted">${t("track", { track: esc(stop.track) })}</span>` : "";
  return `
    <li class="stop ${stop.cancelled ? "cancelled" : ""}" style="--line:${esc(color)}">
      <span class="dot ${isEnd ? "end" : ""}"></span>
      <span class="time">${time(actual, stop.tz)}${delayBadge(delay)}</span>
      <span>${esc(stop.name)}${track}</span>
    </li>`;
}

function renderTrip(data: TripResult): void {
  const legs = data.itinerary.legs.filter((leg) => leg.tripId);
  const main = legs[0] ?? data.itinerary.legs[0];
  title.textContent = main ? `${main.line ?? ""} → ${main.headsign ?? main.to.name}` : data.tripId;
  if (main) {
    const agency = main.agency ? ` · ${main.agency}` : "";
    subtitle.textContent = `${day(main.startTime, main.from.tz)} · ${duration(data.itinerary.durationSeconds)}${agency}`;
  } else {
    subtitle.textContent = "";
  }
  const timeline = legs
    .map((leg) => {
      const color = leg.routeColor ?? "#888";
      const stops = [leg.from, ...(leg.intermediateStops ?? []), leg.to];
      return `
        <div class="toolbar">${lineBadge(leg.mode, leg.line, leg.routeColor, leg.routeTextColor, leg.agency)} <span>${esc(leg.headsign ?? leg.to.name)}</span></div>
        <ol class="timeline">${stops.map((s, i) => stopRow(s, color, i === 0 || i === stops.length - 1)).join("")}</ol>`;
    })
    .join("");
  content.innerHTML = `
    <div class="toolbar"><button type="button" id="back" ${history.length ? "" : "hidden"}>${t("departures.backToBoard")}</button></div>
    ${timeline}`;
  document.getElementById("back")?.addEventListener("click", () => {
    const previous = history.pop();
    if (previous) show(previous, false);
  });
}

const style = document.createElement("style");
style.textContent = `
  table.board { width: 100%; border-collapse: collapse; }
  table.board td { padding: 6px; border-bottom: 1px solid var(--color-border-secondary); vertical-align: top; }
  table.board tr.clickable { cursor: pointer; }
  table.board tr.clickable:hover { background: var(--color-background-secondary); }
  table.board td:first-child { white-space: nowrap; font-variant-numeric: tabular-nums; }
  ol.timeline { list-style: none; margin: 0 0 8px; padding: 0; }
  ol.timeline .stop { display: grid; grid-template-columns: 18px 90px 1fr; align-items: center; min-height: 28px; position: relative; }
  ol.timeline .stop::before { content: ""; position: absolute; left: 7px; top: 0; bottom: 0; width: 4px; background: var(--line); }
  ol.timeline .stop:first-child::before { top: 50%; }
  ol.timeline .stop:last-child::before { bottom: 50%; }
  ol.timeline .dot { width: 10px; height: 10px; margin-left: 4px; border-radius: 50%; background: var(--color-background-primary); border: 2px solid var(--line); z-index: 1; }
  ol.timeline .dot.end { width: 14px; height: 14px; margin-left: 2px; }
  ol.timeline .time { font-variant-numeric: tabular-nums; }

  /* board of the French stations, with the colors of the SNCF boards (blue: departures, green: arrivals) */
  ol.sncf-board { --bright: #356db9; --dark: #103e7d; list-style: none; margin: 0; padding: 0; background: var(--bright); color: #fff; border-radius: var(--border-radius-sm); overflow: hidden; }
  ol.sncf-board.arrivals { --bright: #24842b; --dark: #0d5f13; }
  ol.sncf-board .train { display: flex; align-items: center; gap: 8px; padding: 8px; cursor: pointer; }
  ol.sncf-board .train:nth-child(2n) { background: var(--dark); }
  ol.sncf-board .train.deleted { background: #b93535; }
  ol.sncf-board .train:hover { filter: brightness(1.15); }
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
  ol.sncf-board .second-line { margin-top: 2px; font-size: 0.7rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ol.sncf-board .second-line:empty { display: none; }
  ol.sncf-board .platform { flex: none; display: flex; align-items: center; justify-content: center; min-width: 2rem; height: 2rem; padding: 0 0.1rem; box-sizing: border-box; border: 2px solid #eee; border-radius: 4px; background: #eee; color: #333; font-size: 1.25rem; font-weight: 700; white-space: nowrap; }
  ol.sncf-board .platform.empty { background: transparent; border-color: transparent; }
  ol.sncf-board .deleted .platform { color: #ff5c5c; }
`;
document.head.appendChild(style);
