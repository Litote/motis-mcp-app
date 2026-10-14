// Journey planner: itineraries (plan_journey) as a list, the selected one on a map.
import L from "leaflet";
import { callTool, startView, type Args } from "./shared/app";
import { day, delayBadge, delayMinutes, distance, duration, esc, lineBadge, modeColor, modeLabel, time } from "./shared/format";
import { t } from "./shared/i18n";
import { createMap, decode, fit } from "./shared/map";
import type { ItineraryDto, JourneyResult, LegDto } from "./shared/types";

const title = document.getElementById("title")!;
const subtitle = document.getElementById("subtitle")!;
const content = document.getElementById("content")!;
content.innerHTML = `
  <div class="toolbar">
    <button type="button" id="earlier" data-i18n="earlier">← Earlier</button>
    <button type="button" id="later" data-i18n="later">Later →</button>
  </div>
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
const themedMap = createMap(document.getElementById("map")!);
const { map, setTheme } = themedMap;
const layer = L.featureGroup().addTo(map);

let journey: JourneyResult | null = null;
let planArgs: Args = {};

const app = startView("MOTIS journey planner", {
  render: (data, args) => {
    planArgs = { ...args, pageCursor: undefined };
    render(data as unknown as JourneyResult);
  },
  themeChanged: setTheme,
});

/** All the itineraries: public transport ones, then direct ones (walk, bike...). */
const allItineraries = (j: JourneyResult): ItineraryDto[] => [...j.itineraries, ...j.direct];

function render(data: JourneyResult): void {
  journey = data;
  const tz = data.from.tz;
  title.textContent = `${data.from.name} → ${data.to.name}`;
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
      <div><strong>${time(leg.startTime, leg.from.tz)}</strong>${delayText} ${esc(leg.from.name)}</div>
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
    (last ? `<li><div><strong>${time(last.endTime, last.to.tz)}</strong> ${esc(last.to.name)}</div></li>` : "");
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
`;
document.head.appendChild(style);
