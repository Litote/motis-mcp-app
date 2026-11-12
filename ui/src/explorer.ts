// Map explorer: stops and routes of an area (explore_area), a route (route_details), an isochrone (reachability).
import L from "leaflet";
import { callTool, startView } from "./shared/app";
import { esc, lineBadge, modeColor, modeLabel, time } from "./shared/format";
import { t } from "./shared/i18n";
import { arrowLeft } from "./shared/icons";
import { bounds, createMap, decode, fit } from "./shared/map";
import type { AreaResult, DeparturesResult, PlaceDto, ReachabilityResult } from "./shared/types";

type ExplorerData = AreaResult | ReachabilityResult;

const content = document.getElementById("content")!;
content.innerHTML = `
  <div class="toolbar floats-in-fullscreen">
    <button id="back" class="ghost" type="button" hidden>${arrowLeft}<span data-i18n="back">${t("back")}</span></button>
    <div id="chips" class="chips"></div>
  </div>
  <div id="map" class="map"></div>
  <div id="legend" class="legend floats-in-fullscreen"></div>
  <aside id="route-stops" class="floating fullscreen-only" hidden></aside>`;

const title = document.getElementById("title")!;
const subtitle = document.getElementById("subtitle")!;
const back = document.getElementById("back") as HTMLButtonElement;
const chips = document.getElementById("chips")!;
const legend = document.getElementById("legend")!;
const routeStops = document.getElementById("route-stops")!;
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
  routeStops.innerHTML = "";
  routeStops.hidden = true;
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
    `${t("explorer.stops", { count: data.totalStops })} · ${t("explorer.routes", { count: data.totalRoutes })}` +
    (data.stops.length < data.totalStops ? ` ${t("explorer.stopsShown", { count: data.stops.length })}` : "") +
    (data.zoomFiltered ? ` · ${t("explorer.zoomFiltered")}` : "");

  drawRoutes(data);
  drawStops(data);

  // routes are sorted by the server: trains first, then urban transit
  chips.innerHTML =
    data.kind === "routeDetails"
      ? ""
      : data.routes
          .map((r) => `<span data-route="${r.routeIdx}" title="${esc(t("explorer.routeStops", { mode: modeLabel(r.mode), count: r.numStops }))}">${lineBadge(r.mode, r.names.join(" / "), r.color, r.textColor)}</span>`)
          .join("");

  if (data.kind === "routeDetails") renderRouteStops(data);

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

/** Markers of the stops of the area, in the order of the stops. */
let stopMarkers: L.CircleMarker[] = [];

/** Stops of a route, in a panel over the fullscreen map: a stop clicked is centered on the map. */
function renderRouteStops(data: AreaResult): void {
  const route = data.routes[0];
  if (!route || data.stops.length === 0) return;
  const color = esc(modeColor(route.mode, route.color));
  const stops = data.stops
    .map((stop, i) => `<li><button type="button" class="ghost" data-stop="${i}"><span class="dot"></span>${esc(stop.name)}</button></li>`)
    .join("");
  routeStops.innerHTML = `
    <div class="route-head">${lineBadge(route.mode, route.names.join(" / "), route.color, route.textColor)}
      <span class="muted">${esc(t("explorer.routeStops", { mode: modeLabel(route.mode), count: route.numStops }))}</span></div>
    <ol style="--line:${color}">${stops}</ol>`;
  routeStops.hidden = false;
}

routeStops.addEventListener("click", (e) => {
  const button = (e.target as HTMLElement).closest<HTMLElement>("[data-stop]");
  const marker = button ? stopMarkers[Number(button.dataset.stop)] : undefined;
  if (!marker) return;
  map.setView(marker.getLatLng(), Math.max(map.getZoom(), 15));
  marker.openTooltip();
});

function drawStops(data: AreaResult): void {
  const route = data.kind === "routeDetails" ? data.routes[0] : undefined;
  stopMarkers = [];
  for (const stop of data.stops) {
    const marker = L.circleMarker([stop.lat, stop.lon], {
      radius: data.kind === "routeDetails" ? 5 : 4,
      color: "#fff",
      weight: 1.5,
      fillColor: route ? modeColor(route.mode, route.color) : modeColor(stop.modes?.[0] ?? ""),
      fillOpacity: 1,
    }).addTo(layer);
    marker.bindTooltip(esc(stop.name));
    stopMarkers.push(marker);
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
  marker.bindPopup(`${header}<div class="muted">${t("explorer.loadingDepartures")}</div>`, { maxWidth: 320 }).openPopup();
  try {
    const result = await callTool<DeparturesResult>(app, "departures", { stopId: stop.stopId, count: 8 });
    const rows = result.stopTimes
      .map(
        (st) =>
          `<span class="${st.cancelled ? "cancelled" : ""}">${time(st.time, result.stop.tz)}</span>` +
          lineBadge(st.mode, st.line, st.routeColor, st.routeTextColor, st.agency, st.trainNumber) +
          `<span>${esc(st.headsign)}</span>`,
      )
      .join("");
    const content = rows || `<span class="muted">${t("explorer.noDeparture")}</span>`;
    marker.setPopupContent(`${header}<div class="popup-departures">${content}</div>`);
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
  title.textContent = t("explorer.reachableFrom", { name: data.origin.name });
  subtitle.textContent =
    t("explorer.reachableSummary", { count: data.totalPlaces, max }) +
    (data.places.length < data.totalPlaces ? ` ${t("explorer.shown", { count: data.places.length })}` : "");
  // farthest first, so that the closest places are drawn on top
  for (const place of [...data.places].reverse()) {
    const minutes = place.durationMinutes ?? max;
    const transfers = place.transfers == null ? "" : ` · ${t("transfers", { count: place.transfers })}`;
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
  legend.innerHTML = steps.map((m) => `<span><i style="background:${durationColor(m, max)}"></i>${esc(t("duration.minutes", { minutes: m }))}</span>`).join("");
  fit(themedMap, layer);
}

const style = document.createElement("style");
style.textContent = `
  /* fullscreen: the map fills the view, the routes, the legend and the stops of a route float over it (clear of the
     zoom and fullscreen buttons of the map) */
  :root[data-display-mode="fullscreen"] #content { position: relative; }
  :root[data-display-mode="fullscreen"] #content > .toolbar,
  :root[data-display-mode="fullscreen"] #legend,
  :root[data-display-mode="fullscreen"] #route-stops { position: absolute; z-index: 1000; }
  :root[data-display-mode="fullscreen"] #content > .toolbar { top: 10px; left: 52px; right: 52px; padding: 6px; }
  :root[data-display-mode="fullscreen"] #content > .toolbar:has(#back[hidden]):has(#chips:empty) { display: none; }
  :root[data-display-mode="fullscreen"] #content:has(#route-stops:not([hidden])) > .toolbar { right: 312px; }
  :root[data-display-mode="fullscreen"] #content > .toolbar:has(#chips:empty) { right: auto; }
  :root[data-display-mode="fullscreen"] #legend { left: 10px; bottom: 24px; max-width: calc(100% - 20px); padding: 6px 10px; }
  :root[data-display-mode="fullscreen"] #legend:empty { display: none; }
  :root[data-display-mode="fullscreen"] #route-stops:not([hidden]) { display: flex; }
  #route-stops { top: 52px; right: 10px; bottom: 24px; width: 290px; flex-direction: column; gap: 8px; padding: 10px; }
  #route-stops .route-head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
  #route-stops ol { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1; min-height: 0; }
  #route-stops button { position: relative; width: 100%; justify-content: flex-start; gap: 10px; padding: 0 8px 0 0;
    min-height: 32px; color: var(--color-text-primary); font-weight: 400; text-align: left; white-space: normal; }
  #route-stops button::before { content: ""; position: absolute; left: 7px; top: 0; bottom: 0; width: 4px; background: var(--line); }
  #route-stops li:first-child button::before { top: 50%; }
  #route-stops li:last-child button::before { bottom: 50%; }
  #route-stops .dot { position: relative; flex: none; width: 10px; height: 10px; margin-left: 4px; border-radius: 50%;
    border: 2px solid var(--line); background: var(--color-background-primary); }
  @media (max-width: 640px) {
    #route-stops { top: auto; left: 10px; width: auto; max-height: 40%; }
    :root[data-display-mode="fullscreen"] #content:has(#route-stops:not([hidden])) > .toolbar { right: 52px; }
    :root[data-display-mode="fullscreen"] #content:has(#route-stops:not([hidden])) > #legend { display: none; }
  }
`;
document.head.appendChild(style);
