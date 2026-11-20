// Departures board (departures) and trip timeline (trip_details).
import { callTool, isFullscreen, startView, type Args } from "./shared/app";
import { day, delayMinutes, duration, esc, lineBadge, stopTimeHtml, time } from "./shared/format";
import { t } from "./shared/i18n";
import { alertBanner, alertLine, alertList, alertMark, alertsOf } from "./shared/alerts";
import { arrowLeft, chevronLeft, chevronRight, trainFront } from "./shared/icons";
import { RAIL_MODES, TRAIN_MODES, linePictogram, train } from "./shared/sncf";
import { inTab, stationTabs, type StationTab } from "./shared/stationTabs";
import type { AlertDto, DeparturesResult, PlaceDto, StopTimeDto, TripResult } from "./shared/types";

type BoardData = DeparturesResult | TripResult;

const title = document.getElementById("title")!;
const subtitle = document.getElementById("subtitle")!;
const content = document.getElementById("content")!;

const history: BoardData[] = [];
let current: BoardData | null = null;
/** Arguments of the departures call, reused for paging and the arrivals toggle. */
let boardArgs: Args = {};
/** Tabs of the board of a railway station (none for the other stops), and the one shown. */
let tabs: StationTab[] = [];
let activeTab: StationTab | null = null;
/** Fullscreen: board of the other direction (the arrivals of a departures board...), shown beside the board. */
let opposite: DeparturesResult | null = null;
/** Fullscreen: trip opened from the boards, shown in a panel beside them (null while loading). */
let panelTrip: TripResult | null = null;
/** Fullscreen: id of the trip of the panel, loaded or loading; null when the panel is closed. */
let panelTripId: string | null = null;
/** Station of the board the trip shown was opened from, in bold in its stops (null for a trip asked directly). */
let tripFrom: BoardStop | null = null;

/** Station of a board and the scheduled time there of a departure (or an arrival) of it. */
interface BoardStop {
  place: PlaceDto;
  scheduledTime?: string;
  arriveBy: boolean;
}

const app = startView("MOTIS departures", {
  render: (data, args) => {
    history.length = 0;
    opposite = null;
    tripFrom = null;
    closeTripPanel();
    if (data.kind !== "departures") {
      show(data as unknown as BoardData, false);
      return;
    }
    const departures = data as unknown as DeparturesResult;
    boardArgs = { ...args, pageCursor: undefined };
    tabs = stationTabs(departures.stationLines ?? []);
    activeTab = tabs[0] ?? null;
    if (!activeTab) {
      show(departures, false);
      void loadOpposite();
      return;
    }
    // the departures of the tab in the result first, then all of them
    show({ ...departures, stopTimes: departures.stopTimes.filter((st) => inTab(activeTab!, st)) }, false);
    void selectTab(activeTab);
  },
  displayModeChanged: () => {
    const trip = panelTrip;
    closeTripPanel();
    opposite = null;
    // back inline, the trip of the panel is shown in place of the board, as when opened inline
    if (trip && !isFullscreen()) show(trip, true);
    else if (current) show(current, false);
    void loadOpposite();
    tickClock();
  },
});

/** Shows the departures of the station on the lines of [tab]. */
function selectTab(tab: StationTab): Promise<void> {
  activeTab = tab;
  const board = reload({ station: true, modes: tab.modes, lines: tab.lines, pageCursor: undefined });
  void loadOpposite();
  return board;
}

/** Number of the last request of the opposite board: the answers of the previous ones are ignored. */
let lastOpposite = 0;

/** Fullscreen: loads the board of the other direction (page [pageCursor]), shown beside the board. */
async function loadOpposite(pageCursor?: string): Promise<void> {
  if (!isFullscreen() || current?.kind !== "departures") return;
  const board = current;
  const request = ++lastOpposite;
  try {
    const data = await callTool<DeparturesResult>(app, "departures", {
      ...boardArgs,
      stopId: boardArgs.stopId ?? board.stop.stopId,
      arriveBy: !board.arriveBy,
      pageCursor,
    });
    if (request !== lastOpposite || !isFullscreen()) return;
    opposite = data;
    if (current?.kind === "departures") showOpposite(current);
  } catch {
    // reported in the status bar
  }
}

// ─── Clock of the fullscreen boards, in the time zone of the station ───────────

const clock = document.createElement("span");
clock.className = "clock fullscreen-only";
document.getElementById("fullscreen")?.before(clock);
let clockTimer: ReturnType<typeof setInterval> | undefined;

function tickClock(): void {
  if (!isFullscreen()) {
    clearInterval(clockTimer);
    clockTimer = undefined;
    return;
  }
  clockTimer ??= setInterval(tickClock, 10_000);
  const tz = current?.kind === "departures" ? current.stop.tz : undefined;
  clock.textContent = time(new Date().toISOString(), tz);
}

function tabBar(): string {
  if (!tabs.length) return "";
  const buttons = tabs
    .map((tab, i) => {
      const content = tab.pictogram ? `<span class="sncf-line">${tab.pictogram}</span>` : esc(tab.label);
      return `<button type="button" role="tab" data-tab="${i}" aria-selected="${tab === activeTab}" title="${esc(tab.label)}" aria-label="${esc(tab.label)}">${content}</button>`;
    })
    .join("");
  return `<div class="tabs" role="tablist" aria-label="${t("departures.tabs")}">${buttons}</div>`;
}

function show(data: BoardData, push: boolean): void {
  if (push && current) history.push(current);
  current = data;
  if (data.kind === "trip") renderTrip(data);
  else renderBoard(data);
}

/** A theoretical time (no real time) cannot be told from an on-time one: marked on a board mixing both. */
const theoreticalMark = () => `<span class="muted theoretical" title="${t("departures.theoretical.title")}">${t("departures.theoretical")}</span>`;

/**
 * Time with its delay: "08:12 +3" in red, or green when on time in real time. A theoretical time is followed by
 * [theoreticalMark] when [markTheoretical].
 */
function timeCell(st: StopTimeDto, markTheoretical: boolean, tz?: string): string {
  const { time: actual, scheduledTime: scheduled } = st;
  const delay = delayMinutes(actual, scheduled);
  if (!st.realTime) {
    const mark = markTheoretical && !st.cancelled ? " " + theoreticalMark() : "";
    return `<span>${time(scheduled ?? actual, tz)}</span>${mark}`;
  }
  if (delay === 0) return `<span class="on-time" title="${t("departures.realTime")}">${time(actual, tz)}</span>`;
  const sign = delay > 0 ? "+" : "";
  return (
    `<span class="late" title="${t("departures.scheduled", { time: time(scheduled, tz) })}">${time(actual, tz)}</span>` +
    ` <span class="delay">${sign}${delay}</span> <div class="muted scheduled"><s>${time(scheduled, tz)}</s></div>`
  );
}

/** French railway stations get a board like the ones of the SNCF stations (and of Carto Tchoo): not the bus or metro stops. */
function isFrenchStation(data: DeparturesResult): boolean {
  return data.stop.tz === "Europe/Paris" && data.stopTimes.some((st) => RAIL_MODES.has(st.mode));
}

/** Trains and Île-de-France trams, on the SNCF board: the other lines of the station (buses, metros) are listed below it. */
function onSncfBoard(st: StopTimeDto): boolean {
  return RAIL_MODES.has(st.mode) || linePictogram(st.mode, st.line, st.agency) !== null;
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

/**
 * Alerts of the departures of a board: those of a single departure are under its row, the others (of a line, of the
 * station...) under the banner of the board, only marked on their rows.
 */
interface BoardAlerts {
  table?: AlertDto[];
  /** Indexes of the alerts of a single departure. */
  own: Set<number>;
}

/** Most trains named in front of an alert of the banner: beyond, it is about a line, a station... */
const MAX_ALERT_TRAINS = 3;

/**
 * Numbers of the trains of the alert [index], when it is about a few trains only: the SNCF gives the same header to the
 * alerts of different trains ("Votre train est retardé."), they would be the same line under the banner.
 */
function alertTrains(stopTimes: StopTimeDto[], index: number): string | undefined {
  const concerned = stopTimes.filter((st) => st.alerts?.includes(index));
  const numbers = concerned.map((st) => train(st.mode, st.line, st.agency, st.trainNumber)?.number);
  if (numbers.length > MAX_ALERT_TRAINS || numbers.some((n) => !n)) return undefined;
  return [...new Set(numbers)].join(", ");
}

/** Alerts of [st] marked on its row (shared with other departures), and those under it (its own). */
function rowAlerts(st: StopTimeDto, alerts: BoardAlerts): { mark: string; line: string } {
  const indexes = st.alerts ?? [];
  return {
    mark: alertMark(alertsOf(alerts.table, indexes.filter((i) => !alerts.own.has(i)))),
    line: alertLine(alertsOf(alerts.table, indexes.filter((i) => alerts.own.has(i)))),
  };
}

function sncfRow(st: StopTimeDto, index: number, arriveBy: boolean, markTheoretical: boolean, tz: string | undefined, alerts: BoardAlerts): string {
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
  } else if (markTheoretical && !st.realTime) {
    status = theoreticalMark();
  }
  const { mark, line } = rowAlerts(st, alerts);
  return `
    <li class="train ${state} ${pastClass(st)} ${openClass(st)}" data-index="${index}">
      <div class="lines">
        <div class="main-line">
          <span class="origine">${sncfOrigin(st)}</span>
          <span class="numero">${esc(number)}</span>
          <span class="heure">${time(st.scheduledTime ?? st.time, tz)}</span>
          <span class="station-label"><span>${esc(label)}</span>${mark}${status}</span>
        </div>
        <div class="second-line" title="${esc(stops.map((s) => s.name).join(" • "))}">${via}</div>
        ${line}
      </div>
      <span class="platform ${st.track ? "" : "empty"}" title="${st.track ? t("track", { track: esc(st.track) }) : ""}">${esc(st.track)}</span>
    </li>`;
}

/**
 * Fullscreen: shows the [opposite] board beside [data]. Already beside it, only its column is drawn again: the other
 * board and the trip panel are left as they are.
 */
function showOpposite(data: DeparturesResult): void {
  const boards = sideBySide(data);
  const index = opposite ? boards.indexOf(opposite) : -1;
  const column = content.querySelector(`.boards [data-board="${index}"] .board-scroll`);
  if (!opposite || !column || shownBoards.length !== boards.length) {
    renderBoard(data);
    return;
  }
  shownBoards = boards;
  column.innerHTML = boardHtml(opposite);
}

/** Fullscreen: the departures and the arrivals side by side, once both are loaded. */
function sideBySide(data: DeparturesResult): DeparturesResult[] {
  if (!isFullscreen() || !opposite) return [data];
  return data.arriveBy ? [opposite, data] : [data, opposite];
}

function renderBoard(data: DeparturesResult): void {
  const tz = data.stop.tz;
  title.textContent = data.stop.name;
  const first = data.stopTimes[0]?.time;
  const firstDay = first ? ` · ${day(first, tz)}` : "";
  const boards = sideBySide(data);
  const direction = (b: DeparturesResult) => t(b.arriveBy ? "departures.arrivals" : "departures.departures");
  const directions = boards.map(direction).join(" · ");
  subtitle.textContent = `${directions}${firstDay}`;
  if (!isFullscreen()) {
    renderToolbarAnd(data, boards, `<div data-board="0">${boardHtml(data)}</div>`);
    placeTrains();
    return;
  }
  tickClock();
  const columns = boards
    .map(
      (b, i) => `
      <section class="board-column" data-board="${i}">
        ${boards.length > 1 ? `<h2 class="board-head">${direction(b)}</h2>` : ""}
        <div class="board-scroll">${boardHtml(b)}</div>
      </section>`,
    )
    .join("");
  renderToolbarAnd(data, boards, `<div class="boards" style="grid-template-columns: ${boardTracks(boards.length)}">${columns}${tripPanel()}</div>`);
  placeTrains();
}

/**
 * Columns of the fullscreen boards: [count] boards, and the trip panel when open. `0px` rather than `0`: the
 * length is read back with its unit, as the browsers and jsdom 31 serialize it.
 */
const boardTracks = (count: number) =>
  [...Array.from({ length: count }, () => "minmax(0px, 1fr)"), ...(panelTripId ? ["minmax(260px, 340px)"] : [])].join(" ");

/** Board of [data]: like the SNCF boards at a French station, else a generic one. */
function boardHtml(data: DeparturesResult): string {
  const tz = data.stop.tz;
  const all = data.stopTimes.map((st, index) => ({ st, index }));
  // no real time at all (e.g. a feed without it): said once, rather than on each departure
  const theoretical = data.stopTimes.filter((st) => !st.cancelled && !st.realTime).length;
  const allTheoretical = theoretical > 0 && !data.stopTimes.some((st) => st.realTime);
  const mark = theoretical > 0 && !allTheoretical;
  const theoreticalNote = allTheoretical ? `<p class="muted theoretical-note">${t("departures.theoretical.all")}</p>` : "";
  // the alerts of the departures shown (a tab shows some lines of the station): those of a single departure under it
  const counts = new Map<number, number>();
  data.stopTimes.flatMap((st) => st.alerts ?? []).forEach((i) => counts.set(i, (counts.get(i) ?? 0) + 1));
  const alerts: BoardAlerts = { table: data.alerts, own: new Set([...counts].filter(([, n]) => n === 1).map(([i]) => i)) };
  const shared = [...counts.keys()].filter((i) => !alerts.own.has(i)).filter((i) => data.alerts?.[i]);
  const note = alertBanner(alertsOf(data.alerts, shared), tz, shared.map((i) => alertTrains(data.stopTimes, i))) + theoreticalNote;
  if (isFrenchStation(data)) {
    // in the order of their scheduled times, shown on the board, as on the SNCF boards: a late train keeps its place
    const trains = all.filter(({ st }) => onSncfBoard(st)).sort((a, b) => scheduledAt(a.st) - scheduledAt(b.st));
    const others = all.filter(({ st }) => !onSncfBoard(st));
    const rows = trains.map(({ st, index }) => sncfRow(st, index, data.arriveBy, mark, tz, alerts)).join("");
    const otherLines = others.length ? `<h3>${t("departures.otherLines")}</h3>${boardTable(others, data.arriveBy, mark, tz, alerts)}` : "";
    return `${note}<ol class="sncf-board ${data.arriveBy ? "arrivals" : ""}">${rows}</ol>${otherLines}`;
  }
  return all.length ? note + boardTable(all, data.arriveBy, mark, tz, alerts) : `<p class="muted">${t("departures.none")}</p>`;
}

/** Scheduled time of a departure in ms, its expected one without it (sorts the SNCF board). */
const scheduledAt = (st: StopTimeDto) => Date.parse(st.scheduledTime ?? st.time ?? "") || 0;

/**
 * Class of a departure gone (an arrival made): the minute of its expected time, else of its theoretical one, is over.
 * The times are shown to the minute: a train due at 08:12 is not gone while the clock still says 08:12.
 */
const pastClass = (st: StopTimeDto) => (st.time && Date.parse(st.time) + 60_000 <= Date.now() ? "past" : "");

/** Class of the departure of the trip opened in the panel. */
const openClass = (st: StopTimeDto) => (panelTripId === st.tripId ? "open" : "");

/** Boards shown, by their index in `data-board`. */
let shownBoards: DeparturesResult[] = [];

/**
 * Generic board of the [departures], with their index in the result, and the [alerts] of the board. An arrival shows where
 * it comes from: its destination is often this station.
 */
function boardTable(departures: { st: StopTimeDto; index: number }[], arriveBy: boolean, markTheoretical: boolean, tz: string | undefined, alerts: BoardAlerts): string {
  const rows = departures
    .map(({ st, index }) => ({ st, index, ...rowAlerts(st, alerts) }))
    .map(
      ({ st, index, mark, line }) => `
      <tr class="clickable ${pastClass(st)} ${openClass(st)}" data-index="${index}">
        <td class="${st.cancelled ? "cancelled" : ""}">${timeCell(st, markTheoretical, tz)}</td>
        <td>${lineBadge(st.mode, st.line, st.routeColor, st.routeTextColor)}</td>
        <td>${esc((arriveBy ? st.stops?.[0]?.name : undefined) ?? st.headsign)}${mark}${st.cancelled ? ` <strong class="late">${t("departures.cancelled")}</strong>` : ""}<div class="muted">${esc(st.agency)}</div>${line}</td>
        <td>${st.track ? `<span class="track">${t("track", { track: esc(st.track) })}</span>` : ""}</td>
      </tr>`,
    )
    .join("");
  return `<table class="board"><tbody>${rows}</tbody></table>`;
}

/**
 * Paging and departures / arrivals buttons, then the [board] html showing the [boards] (their index in `data-board`):
 * the departures / arrivals buttons are left out when both are shown.
 */
function renderToolbarAnd(data: DeparturesResult, boards: DeparturesResult[], board: string): void {
  const directions =
    boards.length > 1
      ? ""
      : `<div class="segmented" role="group">
        <button type="button" data-action="departures" aria-pressed="${!data.arriveBy}">${t("departures.departures")}</button>
        <button type="button" data-action="arrivals" aria-pressed="${data.arriveBy}">${t("departures.arrivals")}</button>
      </div>`;
  shownBoards = boards;
  content.innerHTML = `
    ${tabBar()}
    <div class="toolbar">
      <div class="button-group">
        <button type="button" data-action="previous" ${data.previousPageCursor ? "" : "disabled"}>${chevronLeft}<span>${t("earlier")}</span></button>
        <button type="button" data-action="next" ${data.nextPageCursor ? "" : "disabled"}><span>${t("later")}</span>${chevronRight}</button>
      </div>
      <span class="spacer"></span>
      ${directions}
    </div>
    ${board}`;

  content.querySelectorAll<HTMLButtonElement>("button[data-tab]").forEach((button) =>
    button.addEventListener("click", () => {
      content.querySelectorAll("button[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b === button)));
      void selectTab(tabs[Number(button.dataset.tab)]);
    }),
  );
  content.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((button) =>
    button.addEventListener("click", () => {
      const action = button.dataset.action;
      if (action === "close-trip") return;
      // the other board of the fullscreen pages along
      if (boards.length > 1 && (action === "previous" || action === "next"))
        void loadOpposite(action === "previous" ? opposite?.previousPageCursor : opposite?.nextPageCursor);
      if (action === "previous") void reload({ pageCursor: data.previousPageCursor });
      // later departures of a French station with other lines (buses, metros): its trains only, to fill the board
      else if (action === "next" && !activeTab && isFrenchStation(data) && data.stopTimes.some((st) => !onSncfBoard(st)))
        void reload({ pageCursor: data.nextPageCursor, modes: TRAIN_MODES });
      else if (action === "next") void reload({ pageCursor: data.nextPageCursor });
      else void reload({ arriveBy: action === "arrivals", pageCursor: undefined });
    }),
  );
}

/** Number of the last board request: the answers of the previous ones (another tab clicked meanwhile) are ignored. */
let lastReload = 0;

async function reload(changes: Args): Promise<void> {
  const { pageCursor, ...rest } = changes;
  boardArgs = { ...boardArgs, ...rest, stopId: boardArgs.stopId ?? (current?.kind === "departures" ? current.stop.stopId : undefined) };
  const request = ++lastReload;
  try {
    const data = await callTool<DeparturesResult>(app, "departures", { ...boardArgs, pageCursor });
    if (request === lastReload) show(data, false);
  } catch {
    // reported in the status bar
  }
}

/**
 * Opens a trip: in a panel beside the boards in fullscreen (loading in the panel, the boards left as they are), else
 * in place of the board.
 */
async function openTrip(tripId: string, realTimeTripId?: string): Promise<void> {
  // the trip of the other feed, if any, gives its real time
  const args = realTimeTripId ? { tripId, realTimeTripId } : { tripId };
  if (!isFullscreen() || current?.kind !== "departures") {
    try {
      show(await callTool<TripResult>(app, "trip_details", args), true);
      // opened from the bottom of a long board: its top brought back into view, the view (sized to its content)
      // scrolling in the page of the host
      document.querySelector("header")?.scrollIntoView?.({ block: "nearest" });
    } catch {
      // reported in the status bar
    }
    return;
  }
  panelTripId = tripId;
  panelTrip = null;
  updateTripPanel();
  try {
    const trip = await callTool<TripResult>(app, "trip_details", args, { quiet: true });
    // another trip clicked, or the panel closed, meanwhile
    if (panelTripId !== tripId) return;
    panelTrip = trip;
  } catch {
    // reported in the status bar
    if (panelTripId === tripId) closeTripPanel();
  }
  updateTripPanel();
}

function closeTripPanel(): void {
  panelTrip = null;
  panelTripId = null;
}

/** Fullscreen: shows the trip panel, or removes it, and marks the departure of its trip, the boards left as they are. */
function updateTripPanel(): void {
  const boards = content.querySelector<HTMLElement>(".boards");
  if (!boards) return;
  boards.querySelector(".trip-panel")?.remove();
  boards.insertAdjacentHTML("beforeend", tripPanel());
  boards.style.gridTemplateColumns = boardTracks(shownBoards.length);
  placeTrains();
  boards.querySelectorAll<HTMLElement>("[data-board]").forEach((column) => {
    const board = shownBoards[Number(column.dataset.board)];
    column.querySelectorAll<HTMLElement>("[data-index]").forEach((row) => {
      row.classList.toggle("open", board?.stopTimes[Number(row.dataset.index)]?.tripId === panelTripId);
    });
  });
}

content.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (target.closest("[data-action=close-trip]")) {
    closeTripPanel();
    updateTripPanel();
    return;
  }
  // a departure of a board (the columns of the fullscreen boards may be drawn again on their own)
  const row = target.closest<HTMLElement>("[data-board] [data-index]");
  const board = row ? shownBoards[Number(row.closest<HTMLElement>("[data-board]")!.dataset.board)] : undefined;
  const departure = board?.stopTimes[Number(row!.dataset.index)];
  if (!departure) return;
  tripFrom = { place: board!.stop, scheduledTime: departure.scheduledTime ?? departure.time, arriveBy: board!.arriveBy };
  void openTrip(departure.tripId, departure.realTimeTripId);
});

/** Time of a stop of a trip (its departure, else its arrival), and its delay (advance when negative) in minutes. */
function stopTiming(stop: PlaceDto): { actual?: string; scheduled?: string } {
  const departure = stop.departure ?? stop.scheduledDeparture;
  const actual = departure ?? stop.arrival ?? stop.scheduledArrival;
  return { actual, scheduled: departure ? stop.scheduledDeparture : stop.scheduledArrival };
}

/** Stop of a trip: its time and its [delay] badge; the station of the board in bold. */
function stopRow(stop: PlaceDto, color: string, isEnd: boolean, isBoardStop: boolean): string {
  const { actual, scheduled } = stopTiming(stop);
  const track = stop.track ? ` <span class="muted">${t("track", { track: esc(stop.track) })}</span>` : "";
  const classes = ["stop", stop.cancelled ? "cancelled" : "", isBoardStop ? "board-stop" : ""].filter(Boolean).join(" ");
  return `
    <li class="${classes}" style="--line:${esc(color)}">
      <span class="dot ${isEnd ? "end" : ""}"></span>
      <span class="time">${stopTimeHtml(actual, scheduled, stop.tz)}</span>
      <span class="name">${esc(stop.name)}${track}</span>
    </li>`;
}

/** Icon of the train on the line of a trip, where it is now. */
const vehicle = () =>
  `<span class="vehicle" role="img" title="${t("departures.trainHere")}" aria-label="${t("departures.trainHere")}">${trainFront}</span>`;

/** Stops of the legs of a trip, in the order of their timelines. */
const legStops = (data: TripResult) =>
  data.itinerary.legs.filter((leg) => leg.tripId).map((leg) => ({ leg, stops: [leg.from, ...(leg.intermediateStops ?? []), leg.to] }));

/** Moves the train of the trips shown (the trip in place of the board, or in the panel) every minute. */
let trainTimer: ReturnType<typeof setInterval> | undefined;

/**
 * Puts the train of the trips shown where it is now: on the dot of its stop, or on the line between two stops. Only
 * the icon moves, the rest of the timelines left as they are (and the trip panel where it was scrolled to).
 */
function placeTrains(): void {
  const shown = [
    { root: current?.kind === "trip" ? content.querySelector(".trip") : null, trip: current?.kind === "trip" ? current : null },
    { root: content.querySelector(".trip-panel"), trip: panelTrip },
  ];
  const now = Date.now();
  let any = false;
  for (const { root, trip } of shown) {
    if (!root || !trip) continue;
    any = true;
    root.querySelectorAll(".vehicle, ol.timeline > li.between").forEach((el) => el.remove());
    root.querySelectorAll("li.stop.train-here").forEach((li) => li.classList.remove("train-here"));
    const timelines = root.querySelectorAll("ol.timeline");
    legStops(trip).forEach(({ stops }, i) => {
      const position = trainPosition(stops, now);
      const row = position && timelines[i]?.children[stops.indexOf("at" in position ? position.at : position.after)];
      if (!row) return;
      if ("at" in position) {
        row.classList.add("train-here");
        row.insertAdjacentHTML("afterbegin", vehicle());
      } else row.insertAdjacentHTML("afterend", `<li class="between">${vehicle()}</li>`);
    });
  }
  if (any) trainTimer ??= setInterval(placeTrains, 60_000);
  else {
    clearInterval(trainTimer);
    trainTimer = undefined;
  }
}

const ms = (iso?: string) => (iso ? Date.parse(iso) : NaN);

/**
 * Where the train of the [stops] (of a leg) is at [now]: at a stop (between its arrival and its departure), or between
 * a stop and the next one; null before its departure from the first stop, from its arrival at the last one. The
 * cancelled stops are passed by.
 */
function trainPosition(stops: PlaceDto[], now: number): { at: PlaceDto } | { after: PlaceDto } | null {
  const served = stops.filter((s) => !s.cancelled);
  for (let i = 0; i < served.length; i++) {
    const stop = served[i];
    const arrival = ms(stop.arrival ?? stop.scheduledArrival);
    const departure = ms(stop.departure ?? stop.scheduledDeparture);
    if (i === served.length - 1) return null;
    if (i > 0 && arrival <= now && now < departure) return { at: stop };
    const next = served[i + 1];
    if (departure <= now && now < ms(next.arrival ?? next.scheduledArrival ?? next.departure ?? next.scheduledDeparture)) return { after: stop };
  }
  return null;
}

const normalized = (name: string) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** Distance in km between two places (equirectangular: a few km at most). */
function distanceKm(a: PlaceDto, b: PlaceDto): number {
  const x = ((b.lon - a.lon) * Math.PI) / 180 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const y = ((b.lat - a.lat) * Math.PI) / 180;
  return Math.hypot(x, y) * 6371;
}

/**
 * Stop of the [stops] of a trip at the station of the board it was opened [from]. The stops of the trip may come from
 * another feed than the board (another id, the name of a hall): the one of the same id or name, or the nearest within
 * 1 km, the one at the scheduled time of the departure first (a trip through the station twice).
 */
function boardStopOf(stops: PlaceDto[], from: BoardStop): PlaceDto | undefined {
  const name = normalized(from.place.name);
  const named = (s: PlaceDto) => (!!s.stopId && s.stopId === from.place.stopId) || normalized(s.name) === name;
  const near = stops.filter((s) => named(s) || distanceKm(s, from.place) < 1);
  const at = ms(from.scheduledTime);
  const onTime = near.find((s) => ms(from.arriveBy ? s.scheduledArrival : s.scheduledDeparture) === at);
  return onTime ?? near.find(named) ?? near.sort((a, b) => distanceKm(a, from.place) - distanceKm(b, from.place))[0];
}

/** Title and subtitle of a trip. */
function tripHeading(data: TripResult): { title: string; subtitle: string } {
  const main = data.itinerary.legs.find((leg) => leg.tripId) ?? data.itinerary.legs[0];
  if (!main) return { title: data.tripId, subtitle: "" };
  const agency = main.agency ? ` · ${main.agency}` : "";
  return {
    title: `${main.line ?? ""} → ${main.headsign ?? main.to.name}`,
    subtitle: `${day(main.startTime, main.from.tz)} · ${duration(data.itinerary.durationSeconds)}${agency}`,
  };
}

/**
 * Stops of the legs of a trip, as a timeline in the color of their line: the station of the board it was opened from
 * in bold. The train is put on it once shown (see placeTrains).
 */
function tripTimeline(data: TripResult): string {
  const legs = legStops(data);
  const boardStop = tripFrom ? boardStopOf(legs.flatMap(({ stops }) => stops), tripFrom) : undefined;
  return legs
    .map(({ leg, stops }) => {
      const color = leg.routeColor ?? "#888";
      const rows = stops.map((s, i) => stopRow(s, color, i === 0 || i === stops.length - 1, s === boardStop));
      return `
        <div class="toolbar">${lineBadge(leg.mode, leg.line, leg.routeColor, leg.routeTextColor, leg.agency)} <span>${esc(leg.headsign ?? leg.to.name)}</span></div>
        ${alertList(alertsOf(data.alerts, leg.alerts), leg.from.tz)}
        <ol class="timeline" style="--line:${esc(color)}">${rows.join("")}</ol>`;
    })
    .join("");
}

function renderTrip(data: TripResult): void {
  const heading = tripHeading(data);
  title.textContent = heading.title;
  subtitle.textContent = heading.subtitle;
  content.innerHTML = `
    <div class="toolbar"><button type="button" id="back" ${history.length ? "" : "hidden"}>${arrowLeft}<span>${t("departures.backToBoard")}</span></button></div>
    <div class="trip">${tripTimeline(data)}</div>`;
  placeTrains();
  document.getElementById("back")?.addEventListener("click", () => {
    const previous = history.pop();
    if (!previous) return;
    show(previous, false);
    void loadOpposite();
  });
}

/** Fullscreen: panel of the trip opened from the boards (or loading), with a button to close it. */
function tripPanel(): string {
  if (!panelTripId) return "";
  const heading = panelTrip ? tripHeading(panelTrip) : { title: t("loading"), subtitle: "" };
  const close = `<button type="button" class="ghost icon" data-action="close-trip" title="${t("close")}" aria-label="${t("close")}">✕</button>`;
  return `
    <aside class="trip-panel" aria-label="${esc(heading.title)}" aria-busy="${!panelTrip}">
      <div class="trip-panel-head"><strong>${esc(heading.title)}</strong>${close}</div>
      ${panelTrip ? `<div class="muted">${esc(heading.subtitle)}</div>${tripTimeline(panelTrip)}` : ""}
    </aside>`;
}

const style = document.createElement("style");
style.textContent = `
  table.board { width: 100%; border-collapse: collapse; }
  table.board td { padding: 8px 6px; border-bottom: 1px solid var(--color-border-secondary); vertical-align: top; }
  table.board tr:last-child td { border-bottom: 0; }
  table.board tr.clickable { cursor: pointer; }
  table.board tr.clickable:hover td { background: var(--color-background-secondary); }
  /* the departures gone, before the time of the board: "earlier" pages back */
  table.board tr.past td, ol.sncf-board .train.past > * { opacity: 0.5; }
  table.board td:first-child { white-space: nowrap; font-variant-numeric: tabular-nums; font-weight: 600; }
  table.board td:last-child { text-align: right; }
  table.board .scheduled { font-weight: 400; }
  .tabs { display: flex; gap: 2px; overflow-x: auto; border-bottom: 1px solid var(--color-border-secondary); scrollbar-width: none; }
  .tabs > button { flex: none; min-height: 36px; padding: 0 10px; border: 0; border-radius: 0; background: transparent;
    box-shadow: inset 0 -2px 0 transparent; color: var(--color-text-secondary); }
  .tabs > button:hover:not(:disabled) { background: transparent; color: var(--color-text-primary); box-shadow: inset 0 -2px 0 var(--color-border-primary); }
  .tabs > button[aria-selected="true"] { color: var(--color-text-primary); font-weight: 600; box-shadow: inset 0 -2px 0 var(--accent); }
  .tabs > button:focus-visible { box-shadow: inset 0 0 0 2px var(--accent-soft), inset 0 -2px 0 var(--accent); }
  .tabs .sncf-line svg { width: 1.25rem; height: 1.25rem; }
  ol.timeline { list-style: none; margin: 0 0 8px; padding: 0; }
  ol.timeline .stop { display: grid; grid-template-columns: 18px 104px 1fr; align-items: center; min-height: 28px; position: relative; }
  ol.timeline .stop::before { content: ""; position: absolute; left: 7px; top: 0; bottom: 0; width: 4px; background: var(--line); }
  ol.timeline .stop:first-child::before { top: 50%; }
  ol.timeline .stop:last-child::before { bottom: 50%; }
  ol.timeline .dot { width: 10px; height: 10px; margin-left: 4px; border-radius: 50%; background: var(--color-background-primary); border: 2px solid var(--line); z-index: 1; }
  ol.timeline .dot.end { width: 14px; height: 14px; margin-left: 2px; }
  /* room for the train on the dot of its stop */
  ol.timeline .time { padding-left: 6px; font-variant-numeric: tabular-nums; }
  ol.timeline .board-stop .name { font-weight: 700; }
  /* the train where it is now: on the dot of its stop, or on the line between two stops */
  ol.timeline .between { display: grid; grid-template-columns: 18px; min-height: 26px; align-items: center; position: relative; }
  ol.timeline .between::before { content: ""; position: absolute; left: 7px; top: 0; bottom: 0; width: 4px; background: var(--line); }
  ol.timeline .stop.train-here > .dot { display: none; }
  ol.timeline .vehicle { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; margin-left: -2px; border-radius: 50%;
    background: var(--line); color: #fff; z-index: 1; box-shadow: 0 0 0 2px var(--color-background-primary); }
  .trip-panel ol.timeline .vehicle { box-shadow: 0 0 0 2px var(--color-background-secondary); }
  ol.timeline .vehicle svg { width: 15px; height: 15px; }

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
  ol.sncf-board .theoretical { flex: none; color: #cdd5e0; font-size: 0.7rem; font-weight: 400; white-space: nowrap; }
  ol.sncf-board .second-line { margin-top: 2px; font-size: 0.7rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ol.sncf-board .second-line:empty { display: none; }
  ol.sncf-board .alert-line { color: #fe0; font-size: 0.7rem; }
  ol.sncf-board .platform { flex: none; display: flex; align-items: center; justify-content: center; min-width: 2rem; height: 2rem; padding: 0 0.1rem; box-sizing: border-box; border: 2px solid #eee; border-radius: 4px; background: #eee; color: #333; font-size: 1.25rem; font-weight: 700; white-space: nowrap; }
  ol.sncf-board .platform.empty { background: transparent; border-color: transparent; }
  ol.sncf-board .deleted .platform { color: #ff5c5c; }
  ol.sncf-board .train.open { box-shadow: inset 0 0 0 3px #fe0; }
  table.board tr.open td { background: var(--accent-soft); }

  /* fullscreen: the departures and the arrivals side by side, in bigger type, each scrolling on its own; the trip
     opened beside them; on a phone, one below the other, the trip first */
  .clock { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .boards { display: grid; gap: 10px; flex: 1; min-height: 0; grid-template-rows: minmax(0, 1fr); }
  .board-column { display: flex; flex-direction: column; gap: 6px; min-height: 0; min-width: 0; }
  .board-head { margin: 0; font-size: var(--font-heading-sm-size); font-weight: 600; }
  .board-scroll { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
  .board-scroll > * { flex: none; }
  .board-scroll > p, .board-scroll > h3 { margin: 0; }
  .trip-panel { display: flex; flex-direction: column; gap: 8px; min-height: 0; overflow-y: auto; padding: 12px;
    border: 1px solid var(--color-border-secondary); border-radius: var(--border-radius-md); background: var(--color-background-secondary); }
  .trip-panel-head { display: flex; align-items: center; gap: 8px; }
  .trip-panel-head strong { flex: 1; min-width: 0; }
  .trip-panel ol.timeline .dot { background: var(--color-background-secondary); }
  :root[data-display-mode="fullscreen"] ol.sncf-board { font-size: 17px; }
  :root[data-display-mode="fullscreen"] ol.sncf-board .train { padding: 10px; }
  :root[data-display-mode="fullscreen"] ol.sncf-board .heure { width: 3.6rem; font-size: 1.3em; }
  :root[data-display-mode="fullscreen"] ol.sncf-board .platform { min-width: 2.5rem; height: 2.5rem; font-size: 1.5rem; }
  :root[data-display-mode="fullscreen"] table.board { font-size: 15px; }
  :root[data-display-mode="fullscreen"] .trip { overflow-y: auto; min-height: 0; }
  @media (max-width: 640px) {
    :root[data-display-mode="fullscreen"] .boards { grid-template-columns: minmax(0, 1fr) !important; grid-template-rows: none;
      grid-auto-rows: max-content; overflow-y: auto; }
    :root[data-display-mode="fullscreen"] .board-scroll { overflow: visible; }
    .trip-panel { order: -1; overflow: visible; }
  }
`;
document.head.appendChild(style);
