// Departures board (departures) and trip timeline (trip_details).
import { callTool, startView, type Args } from "./shared/app";
import { day, delayMinutes, duration, esc, lineBadge, time } from "./shared/format";
import type { DeparturesResult, PlaceDto, TripResult } from "./shared/types";

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
  if (delay === 0) return `<span class="on-time" title="real time">${time(actual, tz)}</span>`;
  const sign = delay > 0 ? "+" : "";
  return `<span class="late" title="scheduled ${time(scheduled, tz)}"><s class="muted">${time(scheduled, tz)}</s> ${time(actual, tz)} (${sign}${delay})</span>`;
}

function renderBoard(data: DeparturesResult): void {
  const tz = data.stop.tz;
  title.textContent = data.stop.name;
  const first = data.stopTimes[0]?.time;
  subtitle.textContent = `${data.arriveBy ? "Arrivals" : "Departures"}${first ? ` · ${day(first, tz)}` : ""}`;
  const rows = data.stopTimes
    .map(
      (st, i) => `
      <tr class="clickable" data-index="${i}">
        <td class="${st.cancelled ? "cancelled" : ""}">${timeCell(st.time, st.scheduledTime, st.realTime, tz)}</td>
        <td>${lineBadge(st.mode, st.line, st.routeColor, st.routeTextColor)}</td>
        <td>${esc(st.headsign)}${st.cancelled ? ' <strong class="late">cancelled</strong>' : ""}<div class="muted">${esc(st.agency)}</div></td>
        <td class="muted">${st.track ? `track ${esc(st.track)}` : ""}</td>
      </tr>`,
    )
    .join("");
  content.innerHTML = `
    <div class="toolbar">
      <button type="button" data-action="previous" ${data.previousPageCursor ? "" : "disabled"}>← Earlier</button>
      <button type="button" data-action="next" ${data.nextPageCursor ? "" : "disabled"}>Later →</button>
      <span style="flex:1"></span>
      <button type="button" data-action="departures" aria-pressed="${!data.arriveBy}">Departures</button>
      <button type="button" data-action="arrivals" aria-pressed="${data.arriveBy}">Arrivals</button>
    </div>
    ${rows ? `<table class="board"><tbody>${rows}</tbody></table>` : '<p class="muted">No departure in this period.</p>'}`;

  content.querySelectorAll<HTMLElement>("tr[data-index]").forEach((tr) =>
    tr.addEventListener("click", () => openTrip(data.stopTimes[Number(tr.dataset.index)].tripId)),
  );
  content.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((button) =>
    button.addEventListener("click", () => {
      const action = button.dataset.action;
      if (action === "previous") reload({ pageCursor: data.previousPageCursor });
      else if (action === "next") reload({ pageCursor: data.nextPageCursor });
      else reload({ arriveBy: action === "arrivals", pageCursor: undefined });
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
  return `
    <li class="stop ${stop.cancelled ? "cancelled" : ""}" style="--line:${esc(color)}">
      <span class="dot ${isEnd ? "end" : ""}"></span>
      <span class="time">${time(actual, stop.tz)}${delay !== 0 ? ` <span class="late">${delay > 0 ? "+" : ""}${delay}</span>` : ""}</span>
      <span>${esc(stop.name)}${stop.track ? ` <span class="muted">track ${esc(stop.track)}</span>` : ""}</span>
    </li>`;
}

function renderTrip(data: TripResult): void {
  const legs = data.itinerary.legs.filter((leg) => leg.tripId);
  const main = legs[0] ?? data.itinerary.legs[0];
  title.textContent = main ? `${main.line ?? ""} → ${main.headsign ?? main.to.name}` : data.tripId;
  subtitle.textContent = main ? `${day(main.startTime, main.from.tz)} · ${duration(data.itinerary.durationSeconds)}${main.agency ? ` · ${main.agency}` : ""}` : "";
  const timeline = legs
    .map((leg) => {
      const color = leg.routeColor ?? "#888";
      const stops = [leg.from, ...(leg.intermediateStops ?? []), leg.to];
      return `
        <div class="toolbar">${lineBadge(leg.mode, leg.line, leg.routeColor, leg.routeTextColor)} <span>${esc(leg.headsign ?? leg.to.name)}</span></div>
        <ol class="timeline">${stops.map((s, i) => stopRow(s, color, i === 0 || i === stops.length - 1)).join("")}</ol>`;
    })
    .join("");
  content.innerHTML = `
    <div class="toolbar"><button type="button" id="back" ${history.length ? "" : "hidden"}>← Back to the board</button></div>
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
`;
document.head.appendChild(style);
