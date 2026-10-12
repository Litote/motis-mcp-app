// Map explorer: stops and routes of an area (explore_area), a route (route_details), an isochrone (reachability).
import L from "leaflet";
import { callTool, startView } from "./shared/app";
import { esc, lineBadge, modeColor, modeLabel, time } from "./shared/format";
import { bounds, createMap, decode, fit } from "./shared/map";
import type { AreaResult, DeparturesResult, PlaceDto, ReachabilityResult } from "./shared/types";

type ExplorerData = AreaResult | ReachabilityResult;

const content = document.getElementById("content")!;
content.innerHTML = `
  <div class="toolbar">
    <button id="back" type="button" hidden>← Back</button>
    <div id="chips" class="chips"></div>
  </div>
  <div id="map" class="map"></div>
  <div id="legend" class="legend"></div>`;

const title = document.getElementById("title")!;
const subtitle = document.getElementById("subtitle")!;
const back = document.getElementById("back") as HTMLButtonElement;
const chips = document.getElementById("chips")!;
const legend = document.getElementById("legend")!;
const themedMap = createMap(document.getElementById("map")!);
const { map, setTheme } = themedMap;
const layer = L.featureGroup().addTo(map);

/** Previous results, for the back button. */
const history: ExplorerData[] = [];
let current: ExplorerData | null = null;

const app = startView("MOTIS map explorer", {
  render: (data) => show(data as unknown as ExplorerData, false),
  themeChanged: setTheme,
});

function show(data: ExplorerData, push: boolean): void {
  if (push && current) history.push(current);
  current = data;
  back.hidden = history.length === 0;
  layer.clearLayers();
  chips.innerHTML = "";
  legend.innerHTML = "";
  if (data.kind === "reachability") renderReachability(data);
  else renderArea(data);
}

back.addEventListener("click", () => {
  const previous = history.pop();
  if (previous) show(previous, false);
});

function renderArea(data: AreaResult): void {
  title.textContent = data.title;
  subtitle.textContent =
    `${data.totalStops} stops · ${data.totalRoutes} routes` +
    (data.stops.length < data.totalStops ? ` (${data.stops.length} stops shown)` : "") +
    (data.zoomFiltered ? " · minor routes hidden, zoom in" : "");

  drawRoutes(data);
  drawStops(data);

  // routes are sorted by the server: trains first, then urban transit
  chips.innerHTML =
    data.kind === "routeDetails"
      ? ""
      : data.routes
          .map((r) => `<span data-route="${r.routeIdx}" title="${esc(modeLabel(r.mode))} · ${r.numStops} stops">${lineBadge(r.mode, r.names.join(" / "), r.color, r.textColor)}</span>`)
          .join("");

  const modes = [...new Set(data.routes.map((r) => r.mode))];
  legend.innerHTML = modes.map((m) => `<span><i style="background:${modeColor(m)}"></i>${esc(modeLabel(m))}</span>`).join("");
  // an area is shown as requested (the clipped route shapes extend beyond it), a route entirely
  if (data.kind === "area") themedMap.show(bounds(data.bbox));
  else fit(themedMap, layer, data.bbox);
}

function drawRoutes(data: AreaResult): void {
  const routeByIdx = new Map(data.routes.map((r) => [r.routeIdx, r]));
  for (const p of data.polylines) {
    const route = routeByIdx.get(p.routeIdx[0]);
    const line = L.polyline(decode(p.polyline), {
      color: p.color ?? modeColor(route?.mode ?? "", route?.color),
      weight: data.kind === "routeDetails" ? 5 : 3,
      opacity: 0.85,
    }).addTo(layer);
    const names = p.routeIdx
      .map((i) => routeByIdx.get(i))
      .filter((r) => r != null)
      .map((r) => lineBadge(r.mode, r.names.join(" / "), r.color, r.textColor))
      .join(" ");
    if (names) line.bindTooltip(names, { sticky: true });
    if (data.kind === "area" && p.routeIdx.length > 0) line.on("click", () => void openRoute(p.routeIdx[0]));
  }
}

function drawStops(data: AreaResult): void {
  const route = data.kind === "routeDetails" ? data.routes[0] : undefined;
  for (const stop of data.stops) {
    const marker = L.circleMarker([stop.lat, stop.lon], {
      radius: data.kind === "routeDetails" ? 5 : 4,
      color: "#fff",
      weight: 1.5,
      fillColor: route ? modeColor(route.mode, route.color) : modeColor(stop.modes?.[0] ?? ""),
      fillOpacity: 1,
    }).addTo(layer);
    marker.bindTooltip(esc(stop.name));
    if (stop.stopId) marker.on("click", () => void openStop(marker, stop));
  }
}

chips.addEventListener("click", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-route]");
  if (el) void openRoute(Number(el.dataset.route));
});

async function openRoute(routeIdx: number): Promise<void> {
  try {
    show(await callTool<AreaResult>(app, "route_details", { routeIdx }), true);
  } catch {
    // reported in the status bar
  }
}

/** Popup with the next departures of [stop]. */
async function openStop(marker: L.CircleMarker, stop: PlaceDto): Promise<void> {
  const header = `<strong>${esc(stop.name)}</strong>`;
  marker.bindPopup(`${header}<div class="muted">Loading departures…</div>`, { maxWidth: 320 }).openPopup();
  try {
    const result = await callTool<DeparturesResult>(app, "departures", { stopId: stop.stopId, count: 8 });
    const rows = result.stopTimes
      .map(
        (st) =>
          `<span class="${st.cancelled ? "cancelled" : ""}">${time(st.time, result.stop.tz)}</span>` +
          lineBadge(st.mode, st.line, st.routeColor, st.routeTextColor) +
          `<span>${esc(st.headsign)}</span>`,
      )
      .join("");
    marker.setPopupContent(`${header}<div class="popup-departures">${rows || '<span class="muted">No departure soon</span>'}</div>`);
  } catch (e) {
    marker.setPopupContent(`${header}<div class="muted">${esc(e instanceof Error ? e.message : String(e))}</div>`);
  }
}

/** Color of a travel time, from green (short) to red (max). */
function durationColor(minutes: number, max: number): string {
  const ratio = Math.min(1, Math.max(0, minutes / max));
  return `hsl(${Math.round(130 - 130 * ratio)}, 75%, 45%)`;
}

function renderReachability(data: ReachabilityResult): void {
  const max = data.maxTravelTimeMinutes;
  title.textContent = `Reachable from ${data.origin.name}`;
  subtitle.textContent = `${data.totalPlaces} stops within ${max} min` + (data.places.length < data.totalPlaces ? ` (${data.places.length} shown)` : "");
  // farthest first, so that the closest places are drawn on top
  for (const place of [...data.places].reverse()) {
    const minutes = place.durationMinutes ?? max;
    const transfers = place.transfers == null ? "" : ` · ${place.transfers} transfer(s)`;
    L.circleMarker([place.lat, place.lon], {
      radius: 5,
      stroke: false,
      fillColor: durationColor(minutes, max),
      fillOpacity: 0.85,
    })
      .bindTooltip(`${esc(place.name)}<br>${minutes} min${transfers}`)
      .addTo(layer);
  }
  L.circleMarker([data.origin.lat, data.origin.lon], { radius: 8, color: "#000", weight: 2, fillColor: "#fff", fillOpacity: 1 })
    .bindTooltip(esc(data.origin.name), { permanent: true, direction: "top", offset: [0, -8] })
    .addTo(layer);
  const steps = [0, 0.25, 0.5, 0.75, 1].map((r) => Math.round(r * max));
  legend.innerHTML = steps.map((m) => `<span><i style="background:${durationColor(m, max)}"></i>${m} min</span>`).join("");
  fit(themedMap, layer);
}
