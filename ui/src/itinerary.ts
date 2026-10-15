// Journey planner: itineraries (plan_journey) as a list, the selected one on a map.
import L from "leaflet";
import { callTool, callToolResult, setStatus, startView, updateModelContext, type Args } from "./shared/app";
import { day, delayBadge, delayMinutes, distance, duration, esc, lineBadge, modeColor, modeLabel, time } from "./shared/format";
import { t, type MessageKey } from "./shared/i18n";
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
  return `<label><input type="checkbox" name="mode" value="${group}" checked> <span data-i18n="${key}">${t(key)}</span></label>`;
};

content.innerHTML = `
  <div class="toolbar">
    <button type="button" id="earlier" data-i18n="earlier">← Earlier</button>
    <button type="button" id="later" data-i18n="later">Later →</button>
    <button type="button" id="options-toggle" aria-expanded="false" aria-controls="options" data-i18n="itinerary.options">Options</button>
  </div>
  <form id="options" class="options" hidden>
    <div class="option-row">
      <select name="arriveBy">
        <option value="false" data-i18n="options.leaveAt">${t("options.leaveAt")}</option>
        <option value="true" data-i18n="options.arriveBy">${t("options.arriveBy")}</option>
      </select>
      <input type="datetime-local" name="time">
      <span class="muted" data-i18n="options.time">${t("options.time")}</span>
    </div>
    <fieldset class="option-row">
      <legend data-i18n="options.modes">${t("options.modes")}</legend>
      ${Object.keys(MODE_GROUPS).map(modeCheckbox).join("")}
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
    <div><button type="submit" data-i18n="options.search">${t("options.search")}</button></div>
  </form>
  <div class="journey">
    <ul id="itineraries" class="list"></ul>
    <div>
      <div id="map" class="map"></div>
      <ol id="legs" class="list"></ol>
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
/** Mode groups checked when the options were filled: unchanged, the modes of the call are kept as they are. */
let initialModeGroups = "";

const app = startView("MOTIS journey planner", {
  render: (data, args) => {
    planArgs = { ...args, pageCursor: undefined };
    render(data as unknown as JourneyResult);
    fillOptions(planArgs);
  },
  themeChanged: setTheme,
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
            .map((l) => lineBadge(l.mode, l.line ?? modeLabel(l.mode), l.routeColor, l.routeTextColor))
            .join(" ");
          return `
          <li class="clickable" data-index="${i}">
            <div><strong>${time(it.startTime, tz)} → ${time(it.endTime, data.to.tz)}</strong>
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
    `${lineBadge(leg.mode, leg.line, leg.routeColor, leg.routeTextColor)} → ${esc(leg.headsign ?? leg.to.name)}` +
    `<div class="muted">${t("itinerary.stops", { count: stops })}${track}${agency}</div>`
  );
}

function legDescription(leg: LegDto): string {
  const transit = Boolean(leg.tripId);
  const delay = delayMinutes(leg.startTime, leg.scheduledStartTime);
  const delayText = leg.realTime ? delayBadge(delay) : "";
  const what = transit
    ? transitDescription(leg)
    : `${esc(modeLabel(leg.mode))} ${distance(leg.distanceMeters)} <span class="muted">(${duration(leg.durationSeconds)})</span>`;
  return `
    <li>
      <div><strong>${time(leg.startTime, leg.from.tz)}</strong>${delayText} ${esc(placeName(leg.from))}</div>
      <div class="leg" style="border-color:${esc(modeColor(leg.mode, leg.routeColor))}">${what}</div>
    </li>`;
}

function select(index: number): void {
  if (!journey) return;
  const it = allItineraries(journey)[index];
  list.querySelectorAll("li").forEach((li) => li.classList.toggle("selected", li.dataset.index === String(index)));
  layer.clearLayers();
  for (const leg of it.legs) {
    const transit = Boolean(leg.tripId);
    L.polyline(decode(leg.polyline), {
      color: modeColor(leg.mode, leg.routeColor),
      weight: transit ? 6 : 4,
      opacity: 0.9,
      dashArray: transit ? undefined : "4 8",
    })
      .bindTooltip(transit ? `${esc(leg.line ?? "")} → ${esc(leg.headsign ?? "")}` : esc(modeLabel(leg.mode)), { sticky: true })
      .addTo(layer);
    if (transit) {
      for (const stop of [leg.from, leg.to]) {
        L.circleMarker([stop.lat, stop.lon], { radius: 5, color: "#fff", weight: 2, fillColor: modeColor(leg.mode, leg.routeColor), fillOpacity: 1 })
          .bindTooltip(esc(stop.name))
          .addTo(layer);
      }
    }
  }
  const last = it.legs.at(-1);
  legsList.innerHTML =
    it.legs.map(legDescription).join("") +
    (last ? `<li><div><strong>${time(last.endTime, last.to.tz)}</strong> ${esc(placeName(last.to))}</div></li>` : "");
  fit(themedMap, layer);
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
  field<HTMLSelectElement>("arriveBy").value = String(args.arriveBy === true || args.arriveBy === "true");
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
    arriveBy: field<HTMLSelectElement>("arriveBy").value === "true" || undefined,
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
  #itineraries .badges { margin-top: 4px; display: flex; flex-wrap: wrap; gap: 3px; }
  #legs { margin-top: 8px; }
  #legs .leg { margin: 4px 0 4px 18px; padding: 2px 0 2px 10px; border-left: 4px solid; }
  #options-toggle { margin-left: auto; }
  .options { display: flex; flex-direction: column; gap: 8px; padding: 8px 10px; border: 1px solid var(--color-border-secondary);
    border-radius: var(--border-radius-md); background: var(--color-background-secondary); font-size: var(--font-text-sm-size); }
  .options[hidden] { display: none; }
  .options fieldset { border: 0; margin: 0; padding: 0; }
  .options legend { padding: 0; margin-bottom: 2px; color: var(--color-text-secondary); }
  .option-row { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; }
  .option-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 6px 12px; align-items: end; }
  .option-grid label:not(.check) { display: flex; flex-direction: column; gap: 2px; color: var(--color-text-secondary); }
  .option-grid label.check { padding-bottom: 4px; }
  .options select, .options input:not([type=checkbox]) { font: inherit; color: var(--color-text-primary);
    background: var(--color-background-primary); border: 1px solid var(--color-border-primary);
    border-radius: var(--border-radius-sm); padding: 3px 6px; }
  .options input:focus-visible, .options select:focus-visible { outline: 2px solid var(--color-ring-primary); outline-offset: 1px; }
`;
document.head.appendChild(style);
