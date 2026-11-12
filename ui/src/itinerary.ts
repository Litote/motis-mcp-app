// Journey planner: itineraries (plan_journey) as a list, the selected one on a map.
import L from "leaflet";
import { callTool, callToolResult, setStatus, startView, updateModelContext, type Args } from "./shared/app";
import { day, delayBadge, delayMinutes, distance, duration, esc, lineBadge, modeColor, modeLabel, time } from "./shared/format";
import { t, type MessageKey } from "./shared/i18n";
import { check, chevronLeft, chevronRight, sliders } from "./shared/icons";
import { createMap, decode, fit } from "./shared/map";
import type { ItineraryDto, JourneyResult, LegDto, PlaceDto } from "./shared/types";

const title = document.getElementById("title")!;
const subtitle = document.getElementById("subtitle")!;
const content = document.getElementById("content")!;
/** Transport modes of the options panel: groups of MOTIS modes. */
const MODE_GROUPS: Record<string, string[]> = {
  train: ["RAIL", "HIGHSPEED_RAIL", "LONG_DISTANCE", "NIGHT_RAIL", "REGIONAL_FAST_RAIL", "REGIONAL_RAIL", "SUBURBAN"],
  metro: ["SUBWAY"],
  tram: ["TRAM"],
  bus: ["BUS", "COACH"],
  ferry: ["FERRY"],
  other: ["FUNICULAR", "AERIAL_LIFT", "AIRPLANE", "OTHER"],
};
const WALKING_SPEEDS = ["SLOW", "NORMAL", "FAST"];
const TRANSFER_MARGINS = ["NORMAL", "COMFORTABLE"];
const BIKES = ["NONE", "TO_STATION", "ON_BOARD"];

const choices = (name: string, values: string[]) =>
  values
    .map((v) => {
      const key = `options.${name}.${v}` as MessageKey;
      return `<option value="${v}" data-i18n="${key}">${t(key)}</option>`;
    })
    .join("");

const modeCheckbox = (group: string) => {
  const key = `options.mode.${group}` as MessageKey;
  return `<label class="chip-toggle"><input type="checkbox" name="mode" value="${group}" checked>${check}<span data-i18n="${key}">${t(key)}</span></label>`;
};

content.innerHTML = `
  <div class="toolbar">
    <div class="button-group">
      <button type="button" id="earlier">${chevronLeft}<span data-i18n="earlier">${t("earlier")}</span></button>
      <button type="button" id="later"><span data-i18n="later">${t("later")}</span>${chevronRight}</button>
    </div>
    <span class="spacer"></span>
    <button type="button" id="options-toggle" aria-expanded="false" aria-controls="options">${sliders}<span data-i18n="itinerary.options">${t("itinerary.options")}</span></button>
  </div>
  <form id="options" class="options" hidden>
    <div class="option-row">
      <div class="segmented">
        <label><input type="radio" name="arriveBy" value="false" checked><span data-i18n="options.leaveAt">${t("options.leaveAt")}</span></label>
        <label><input type="radio" name="arriveBy" value="true"><span data-i18n="options.arriveBy">${t("options.arriveBy")}</span></label>
      </div>
      <input type="datetime-local" name="time">
      <span class="muted" data-i18n="options.time">${t("options.time")}</span>
    </div>
    <fieldset>
      <legend data-i18n="options.modes">${t("options.modes")}</legend>
      <div class="option-row">${Object.keys(MODE_GROUPS).map(modeCheckbox).join("")}</div>
    </fieldset>
    <div class="option-grid">
      <label><span data-i18n="options.maxTransfers">${t("options.maxTransfers")}</span>
        <select name="maxTransfers">
          <option value="" data-i18n="options.anyTransfers">${t("options.anyTransfers")}</option>
          ${[0, 1, 2, 3, 4].map((n) => `<option value="${n}">${n}</option>`).join("")}
        </select></label>
      <label title="${t("options.maxWalkHint")}" data-i18n-title="options.maxWalkHint"><span data-i18n="options.maxWalk">${t("options.maxWalk")}</span>
        <input type="number" name="maxWalkMinutes" min="1" max="60" step="1" required></label>
      <label><span data-i18n="options.walkingSpeed">${t("options.walkingSpeed")}</span>
        <select name="walkingSpeed">${choices("walkingSpeed", WALKING_SPEEDS)}</select></label>
      <label><span data-i18n="options.transferMargin">${t("options.transferMargin")}</span>
        <select name="transferMargin">${choices("transferMargin", TRANSFER_MARGINS)}</select></label>
      <label><span data-i18n="options.bike">${t("options.bike")}</span>
        <select name="bike">${choices("bike", BIKES)}</select></label>
      <label class="check"><input type="checkbox" name="wheelchair"> <span data-i18n="options.wheelchair">${t("options.wheelchair")}</span></label>
    </div>
    <div class="options-footer"><button type="submit" class="primary" data-i18n="options.search">${t("options.search")}</button></div>
  </form>
  <div class="journey">
    <ul id="itineraries" class="list"></ul>
    <div class="route">
      <div id="map" class="map"></div>
      <ol id="legs" class="legs"></ol>
    </div>
  </div>`;

const list = document.getElementById("itineraries")!;
const legsList = document.getElementById("legs")!;
const earlier = document.getElementById("earlier") as HTMLButtonElement;
const later = document.getElementById("later") as HTMLButtonElement;
const optionsToggle = document.getElementById("options-toggle") as HTMLButtonElement;
const options = document.getElementById("options") as HTMLFormElement;
const themedMap = createMap(document.getElementById("map")!);
const { map, setTheme } = themedMap;
const layer = L.featureGroup().addTo(map);

let journey: JourneyResult | null = null;
let planArgs: Args = {};
/** Index of the itinerary shown on the map. */
let selected = -1;
/** Lines of the legs of the selected itinerary, by index of leg, with their weight. */
let legLines: { line: L.Polyline; weight: number }[] = [];
/** Mode groups checked when the options were filled: unchanged, the modes of the call are kept as they are. */
let initialModeGroups = "";

const app = startView("MOTIS journey planner", {
  render: (data, args) => {
    planArgs = { ...args, pageCursor: undefined };
    render(data as unknown as JourneyResult);
    fillOptions(planArgs);
  },
  themeChanged: (theme) => {
    setTheme(theme);
    // the lines are drawn in the colors of the page: drawn again once the host variables of the theme are applied
    queueMicrotask(() => {
      if (journey && selected >= 0) select(selected, false);
    });
  },
});

/** Name of a place: the ends of a journey given as coordinates, named `START` and `END` by MOTIS, are translated. */
function placeName(place: PlaceDto): string {
  if (!place.stopId && place.name === "START") return t("itinerary.start");
  if (!place.stopId && place.name === "END") return t("itinerary.end");
  return place.name;
}

/** Name of an end of the journey, with its area when the name does not tell it: `Saint Michel (Bordeaux)`. */
function endName(place: PlaceDto): string {
  const name = placeName(place);
  const area = place.area && !name.toLowerCase().includes(place.area.toLowerCase()) ? place.area : undefined;
  return area ? `${name} (${area})` : name;
}

/** All the itineraries: public transport ones, then direct ones (walk, bike...). */
const allItineraries = (j: JourneyResult): ItineraryDto[] => [...j.itineraries, ...j.direct];

function render(data: JourneyResult): void {
  journey = data;
  const tz = data.from.tz;
  title.textContent = `${endName(data.from)} → ${endName(data.to)}`;
  const first = data.itineraries[0] ?? data.direct[0];
  subtitle.textContent = first ? day(first.startTime, tz) : "";
  earlier.disabled = !data.previousPageCursor;
  later.disabled = !data.nextPageCursor;

  const itineraries = allItineraries(data);
  list.innerHTML = itineraries.length
    ? itineraries
        .map((it, i) => {
          const transit = it.legs.filter((l) => l.tripId || l.line);
          const badges = (transit.length ? transit : it.legs)
            .map((l) => lineBadge(l.mode, l.line ?? modeLabel(l.mode), l.routeColor, l.routeTextColor, l.agency))
            .join(" ");
          return `
          <li class="clickable" data-index="${i}">
            <div class="trip-head"><strong>${time(it.startTime, tz)} → ${time(it.endTime, data.to.tz)}</strong>
              <span class="muted">${duration(it.durationSeconds)} · ${t("transfers", { count: it.transfers })}${i >= data.itineraries.length ? ` · ${t("itinerary.direct")}` : ""}</span></div>
            <div class="badges">${badges}</div>
          </li>`;
        })
        .join("")
    : `<li class="muted">${t("itinerary.none")}</li>`;
  if (itineraries.length) select(0);
  else {
    layer.clearLayers();
    legsList.innerHTML = "";
  }
}

list.addEventListener("click", (e) => {
  const li = (e.target as HTMLElement).closest<HTMLElement>("li[data-index]");
  if (li) select(Number(li.dataset.index));
});

function transitDescription(leg: LegDto): string {
  const stops = (leg.intermediateStops?.length ?? 0) + 1;
  const track = leg.from.track ? ` · ${t("track", { track: esc(leg.from.track) })}` : "";
  const agency = leg.agency ? ` · ${esc(leg.agency)}` : "";
  return (
    `<div class="what">${lineBadge(leg.mode, leg.line, leg.routeColor, leg.routeTextColor, leg.agency)} → ${esc(leg.headsign ?? leg.to.name)}</div>` +
    `<div class="detail">${t("itinerary.stops", { count: stops })}${track}${agency}</div>`
  );
}

function legDescription(leg: LegDto, index: number): string {
  const transit = Boolean(leg.tripId);
  const delay = delayMinutes(leg.startTime, leg.scheduledStartTime);
  const delayText = leg.realTime ? delayBadge(delay) : "";
  const what = transit
    ? transitDescription(leg)
    : `<div class="what">${esc(modeLabel(leg.mode))} ${distance(leg.distanceMeters)} (${duration(leg.durationSeconds)})</div>`;
  return legRow(leg.startTime, leg.from, transit ? "" : "street", modeColor(leg.mode, leg.routeColor), what, delayText, index);
}

/**
 * Step of the timeline of the legs: time, rail in the [color] of the leg (dotted in the street), place and leg. A leg
 * (its [index]) is highlighted on the map when hovered, and shown entirely when clicked.
 */
function legRow(at: string, place: PlaceDto, kind: string, color = "", what = "", delayText = "", index?: number): string {
  const leg = index === undefined ? "" : ` data-leg="${index}" tabindex="0"`;
  return `
    <li class="${kind}" style="--leg:${esc(color)}"${leg}>
      <span class="time">${time(at, place.tz)}${delayText}</span>
      <span class="rail"></span>
      <div class="body"><div class="place">${esc(placeName(place))}</div> ${what}</div>
    </li>`;
}

function select(index: number, refit = true): void {
  if (!journey) return;
  selected = index;
  const it = allItineraries(journey)[index];
  list.querySelectorAll("li").forEach((li) => li.classList.toggle("selected", li.dataset.index === String(index)));
  layer.clearLayers();
  // the lines are drawn in the colors of the page, to stay readable over the roads in both themes
  const colors = getComputedStyle(document.body);
  for (const leg of it.legs) drawCasing(leg, colors.backgroundColor);
  legLines = it.legs.map(drawLeg);
  drawEnds(it.legs, colors.backgroundColor, colors.color);
  const last = it.legs.at(-1);
  legsList.innerHTML = it.legs.map(legDescription).join("") + (last ? legRow(last.endTime, last.to, "end") : "");
  if (refit) fit(themedMap, layer);
}

/** Casing under the line of [leg], in the [background] color. */
function drawCasing(leg: LegDto, background: string): void {
  const weight = leg.tripId ? 11 : 9;
  L.polyline(decode(leg.polyline), { color: background, weight, opacity: 1, interactive: false }).addTo(layer);
}

/** Line of [leg], with its stops on board; in the street round dots, not to be taken for the railways of the map. */
function drawLeg(leg: LegDto): { line: L.Polyline; weight: number } {
  const transit = Boolean(leg.tripId);
  const color = modeColor(leg.mode, leg.routeColor);
  const weight = transit ? 6 : 5;
  const line = L.polyline(decode(leg.polyline), {
    color,
    weight,
    opacity: transit ? 0.95 : 1,
    dashArray: transit ? undefined : "0 9",
    lineCap: "round",
    lineJoin: "round",
  })
    .bindTooltip(transit ? `${esc(leg.line ?? "")} → ${esc(leg.headsign ?? "")}` : esc(modeLabel(leg.mode)), { sticky: true })
    .addTo(layer);
  if (transit) {
    for (const stop of [leg.from, leg.to]) {
      L.circleMarker([stop.lat, stop.lon], { radius: 5, color: "#fff", weight: 2, fillColor: color, fillOpacity: 1 })
        .bindTooltip(esc(stop.name))
        .addTo(layer);
    }
  }
  return { line, weight };
}

/** Highlights the leg [index] on the map: thicker, the other legs faded; none when undefined. */
function highlightLeg(index?: number): void {
  legLines.forEach(({ line, weight }, i) => {
    const highlighted = i === index;
    line.setStyle({ weight: highlighted ? weight + 4 : weight, opacity: index === undefined || highlighted ? 1 : 0.35 });
    if (highlighted) line.bringToFront();
  });
}

/** Shows the leg [index] entirely on the map, highlighted. */
function showLeg(index: number): void {
  const leg = legLines[index];
  if (!leg) return;
  highlightLeg(index);
  const b = leg.line.getBounds();
  if (b.isValid()) themedMap.show(b);
}

const legIndex = (e: Event) => {
  const li = (e.target as HTMLElement).closest<HTMLElement>("li[data-leg]");
  return li ? Number(li.dataset.leg) : undefined;
};
legsList.addEventListener("mouseover", (e) => highlightLeg(legIndex(e)));
legsList.addEventListener("mouseleave", () => highlightLeg());
legsList.addEventListener("focusin", (e) => highlightLeg(legIndex(e)));
legsList.addEventListener("focusout", () => highlightLeg());
legsList.addEventListener("click", (e) => {
  const index = legIndex(e);
  if (index !== undefined) showLeg(index);
});
legsList.addEventListener("keydown", (e) => {
  const index = legIndex(e);
  if (index !== undefined && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    showLeg(index);
  }
});

/** Start of the [legs] as a ring, end as a target, in the [background] and [text] colors of the page. */
function drawEnds(legs: LegDto[], background: string, text: string): void {
  const start = legs[0]?.from;
  const end = legs.at(-1)?.to;
  if (!start || !end) return;
  L.circleMarker([start.lat, start.lon], { radius: 7, color: text, weight: 3, fillColor: background, fillOpacity: 1 })
    .bindTooltip(esc(placeName(start)))
    .addTo(layer);
  L.circleMarker([end.lat, end.lon], { radius: 9, color: background, weight: 2, fillColor: text, fillOpacity: 1 })
    .bindTooltip(esc(placeName(end)))
    .addTo(layer);
  L.circleMarker([end.lat, end.lon], { radius: 3, stroke: false, fillColor: background, fillOpacity: 1, interactive: false }).addTo(layer);
}

async function page(pageCursor?: string): Promise<void> {
  if (!pageCursor) return;
  try {
    render(await callTool<JourneyResult>(app, "plan_journey", { ...planArgs, pageCursor }));
  } catch {
    // reported in the status bar
  }
}

// ─── Options panel ─────────────────────────────────────────────────────────────

const field = <T extends HTMLInputElement | HTMLSelectElement>(name: string) => options.elements.namedItem(name) as T;
const modeBoxes = () => [...options.querySelectorAll<HTMLInputElement>("input[name=mode]")];
const checkedModeGroups = () =>
  modeBoxes()
    .filter((box) => box.checked)
    .map((box) => box.value)
    .join(",");

/** `<input type="datetime-local">` value of an ISO-8601 date-time, in the time zone of the browser. */
function localDateTime(iso: unknown): string {
  if (typeof iso !== "string" || !iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Text of a scalar argument, "" when missing or not a scalar. */
const scalar = (value: unknown): string => (typeof value === "string" || typeof value === "number" ? String(value) : "");

function modesOf(value: unknown): string[] {
  const modes = Array.isArray(value) ? value.map(scalar) : scalar(value).split(",");
  return modes.map((m) => m.trim().toUpperCase()).filter(Boolean);
}

const choice = (value: unknown, values: string[], fallback: string) => {
  const upper = scalar(value).toUpperCase();
  return values.includes(upper) ? upper : fallback;
};

/** Fills the options panel with the arguments of the plan_journey call. */
function fillOptions(args: Args): void {
  (options.elements.namedItem("arriveBy") as RadioNodeList).value = String(args.arriveBy === true || args.arriveBy === "true");
  field<HTMLInputElement>("time").value = localDateTime(args.time);
  const modes = modesOf(args.modes);
  const all = modes.length === 0 || modes.includes("TRANSIT");
  for (const box of modeBoxes()) box.checked = all || MODE_GROUPS[box.value].some((m) => modes.includes(m));
  initialModeGroups = checkedModeGroups();
  const transfers = scalar(args.maxTransfers);
  const maxTransfers = field<HTMLSelectElement>("maxTransfers");
  if (transfers && ![...maxTransfers.options].some((o) => o.value === transfers)) maxTransfers.add(new Option(transfers, transfers));
  maxTransfers.value = transfers;
  field<HTMLInputElement>("maxWalkMinutes").value = scalar(args.maxWalkMinutes) || "25";
  field<HTMLSelectElement>("walkingSpeed").value = choice(args.walkingSpeed, WALKING_SPEEDS, "NORMAL");
  field<HTMLSelectElement>("transferMargin").value = choice(args.transferMargin, TRANSFER_MARGINS, "NORMAL");
  field<HTMLSelectElement>("bike").value = choice(args.bike, BIKES, "NONE");
  field<HTMLInputElement>("wheelchair").checked = args.wheelchair === true || args.wheelchair === "true";
}

/** 'modes' of plan_journey for the checked mode groups: unchanged when not edited, left out when all are checked. */
function modesArg(groups: string): unknown {
  if (groups === initialModeGroups) return planArgs.modes;
  if (groups === Object.keys(MODE_GROUPS).join(",")) return undefined;
  return groups.split(",").flatMap((g) => MODE_GROUPS[g]);
}

/** Arguments of plan_journey from the options panel: the default values are left out. */
function optionArgs(): Args | null {
  const groups = checkedModeGroups();
  if (!groups) return null;
  const time = field<HTMLInputElement>("time").value;
  const maxTransfers = field<HTMLSelectElement>("maxTransfers").value;
  const maxWalkMinutes = Number(field<HTMLInputElement>("maxWalkMinutes").value);
  const walkingSpeed = field<HTMLSelectElement>("walkingSpeed").value;
  const transferMargin = field<HTMLSelectElement>("transferMargin").value;
  const bike = field<HTMLSelectElement>("bike").value;
  const args: Args = {
    from: planArgs.from ?? (journey ? `${journey.from.lat},${journey.from.lon}` : undefined),
    to: planArgs.to ?? (journey ? `${journey.to.lat},${journey.to.lon}` : undefined),
    count: planArgs.count,
    language: planArgs.language,
    time: time ? new Date(time).toISOString() : undefined,
    arriveBy: (options.elements.namedItem("arriveBy") as RadioNodeList).value === "true" || undefined,
    modes: modesArg(groups),
    maxTransfers: maxTransfers === "" ? undefined : Number(maxTransfers),
    maxWalkMinutes: maxWalkMinutes === 25 ? undefined : maxWalkMinutes,
    walkingSpeed: walkingSpeed === "NORMAL" ? undefined : walkingSpeed,
    wheelchair: field<HTMLInputElement>("wheelchair").checked || undefined,
    transferMargin: transferMargin === "NORMAL" ? undefined : transferMargin,
    bike: bike === "NONE" ? undefined : bike,
  };
  return Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
}

fillOptions({});

optionsToggle.addEventListener("click", () => {
  options.hidden = !options.hidden;
  optionsToggle.setAttribute("aria-expanded", String(!options.hidden));
});

options.addEventListener("submit", async (e) => {
  e.preventDefault();
  const args = optionArgs();
  if (!args) {
    setStatus(t("options.noMode"), "error");
    return;
  }
  try {
    const { data, text } = await callToolResult<JourneyResult>(app, "plan_journey", args);
    planArgs = args;
    initialModeGroups = checkedModeGroups();
    render(data);
    await updateModelContext(
      app,
      `The user changed the options in the journey planner view: plan_journey was called again with ${JSON.stringify(args)}.\n${text}`,
    );
  } catch {
    // reported in the status bar
  }
});

earlier.addEventListener("click", () => page(journey?.previousPageCursor));
later.addEventListener("click", () => page(journey?.nextPageCursor));

const style = document.createElement("style");
style.textContent = `
  .journey { display: grid; grid-template-columns: minmax(220px, 1fr) 2fr; gap: 10px; }
  @media (max-width: 640px) { .journey { grid-template-columns: 1fr; } }
  #itineraries { max-height: calc(var(--map-height) + 200px); overflow-y: auto; }
  .journey > * { min-width: 0; }

  /* fullscreen: itineraries | map | legs, each column scrolling on its own; on a phone, the itineraries in a row above
     the map, the legs below it */
  :root[data-display-mode="fullscreen"] .journey { flex: 1; min-height: 0;
    grid-template-columns: minmax(220px, 300px) minmax(0, 1fr) minmax(260px, 340px); grid-template-rows: minmax(0, 1fr); }
  :root[data-display-mode="fullscreen"] .journey .route { display: contents; }
  :root[data-display-mode="fullscreen"] #itineraries { max-height: none; padding: 1px; }
  :root[data-display-mode="fullscreen"] .legs { margin: 0; overflow-y: auto; }
  @media (max-width: 640px) {
    :root[data-display-mode="fullscreen"] .journey { grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto minmax(0, 55fr) minmax(0, 45fr); }
    :root[data-display-mode="fullscreen"] #itineraries { flex-direction: row; overflow-x: auto; overflow-y: hidden; }
    :root[data-display-mode="fullscreen"] #itineraries > li { flex: none; }
    :root[data-display-mode="fullscreen"] #itineraries .badges { display: none; }
  }
  #itineraries .trip-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 2px 8px; }
  #itineraries .trip-head strong { font-variant-numeric: tabular-nums; }
  #itineraries .badges { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px; }

  /* legs of the selected itinerary, as a timeline: plain rail on board, dotted in the street */
  .legs { list-style: none; margin: 14px 0 0; padding: 0 2px; }
  .legs > li { display: grid; grid-template-columns: 48px 16px 1fr; column-gap: 10px; border-radius: var(--border-radius-sm); }
  .legs > li[data-leg] { cursor: pointer; }
  .legs > li[data-leg]:hover { background: var(--color-background-secondary); }
  .legs > li[data-leg]:focus-visible { outline: none; box-shadow: var(--focus-ring); }
  .legs .time { font-weight: 600; font-variant-numeric: tabular-nums; line-height: 20px; white-space: nowrap; }
  .legs .time .delay { display: block; width: max-content; margin-top: 2px; }
  .legs .rail { position: relative; }
  .legs .rail::before { content: ""; position: absolute; z-index: 1; top: 4px; left: 2px; width: 12px; height: 12px;
    border: 3px solid var(--leg); border-radius: 50%; background: var(--color-background-primary); }
  .legs .rail::after { content: ""; position: absolute; top: 16px; bottom: -4px; left: 6px; width: 4px; border-radius: 2px; background: var(--leg); }
  .legs .street .rail::after { left: 6.5px; width: 0; border-radius: 0; background: none; border-left: 3px dotted var(--leg); }
  .legs .end .rail::after { display: none; }
  .legs .end .rail::before { border-color: var(--color-text-primary); background: var(--color-text-primary);
    box-shadow: inset 0 0 0 2px var(--color-background-primary); }
  .legs .body { min-width: 0; padding-bottom: 16px; }
  .legs .place { font-weight: 600; line-height: 20px; }
  .legs .what { margin-top: 4px; }
  .legs .street .what { margin-top: 1px; color: var(--color-text-secondary); font-size: var(--font-text-sm-size); }
  .legs .detail { margin-top: 2px; color: var(--color-text-secondary); font-size: var(--font-text-sm-size); }

  .options { display: flex; flex-direction: column; gap: 14px; padding: 14px; border: 1px solid var(--color-border-secondary);
    border-radius: var(--border-radius-md); background: var(--color-background-secondary); font-size: var(--font-text-sm-size); }
  .options[hidden] { display: none; }
  .options fieldset { border: 0; margin: 0; padding: 0; }
  .options legend, .option-grid label:not(.check) > span { padding: 0; margin-bottom: 6px; font-size: 11px; font-weight: 600;
    letter-spacing: 0.04em; text-transform: uppercase; color: var(--color-text-secondary); }
  .option-row { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; }
  .option-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 12px; align-items: end; }
  .option-grid label:not(.check) { display: flex; flex-direction: column; }
  .option-grid label:not(.check) > span { margin-bottom: 4px; }
  .option-grid label.check { display: inline-flex; align-items: center; gap: 8px; min-height: var(--control-height); }
  .options-footer { display: flex; justify-content: flex-end; padding-top: 12px; border-top: 1px solid var(--color-border-secondary); }
`;
document.head.appendChild(style);
