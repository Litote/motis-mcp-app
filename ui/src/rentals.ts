// Shared mobility (rentals): providers, stations and free-floating vehicles on a map.
import L from "leaflet";
import { startView } from "./shared/app";
import { distance, esc } from "./shared/format";
import { t, tOptional } from "./shared/i18n";
import { createMap, fit } from "./shared/map";
import type { RentalsResult } from "./shared/types";

const title = document.getElementById("title")!;
const subtitle = document.getElementById("subtitle")!;
const content = document.getElementById("content")!;
content.innerHTML = `
  <div class="rentals">
    <aside class="side">
      <div id="providers" class="legend"></div>
      <section class="nearby fullscreen-only">
        <div class="nearby-head">
          <span class="muted" data-i18n="rentals.nearby">${t("rentals.nearby")}</span>
          <div class="segmented" role="group">
            <button type="button" data-sort="distance" aria-pressed="true" data-i18n="rentals.byDistance">${t("rentals.byDistance")}</button>
            <button type="button" data-sort="availability" aria-pressed="false" data-i18n="rentals.byAvailability">${t("rentals.byAvailability")}</button>
          </div>
        </div>
        <ul id="nearby" class="list"></ul>
      </section>
    </aside>
    <div id="map" class="map"></div>
  </div>`;

const providersEl = document.getElementById("providers")!;
const nearbyEl = document.getElementById("nearby")!;
const themedMap = createMap(document.getElementById("map")!);
const { map, setTheme } = themedMap;
const layer = L.featureGroup().addTo(map);

const PALETTE = ["#1c7ed6", "#e8590c", "#2f9e44", "#ae3ec9", "#f08c00", "#0c8599", "#c2255c", "#5f3dc4"];
const formFactor = (f: string): string => tOptional(`formFactor.${f}`) ?? f.toLowerCase();
const propulsion = (p: string): string => tOptional(`propulsion.${p}`) ?? p.toLowerCase();

let data: RentalsResult | null = null;
const hidden = new Set<string>();
/** Order of the nearby list (fullscreen). */
let sort: "distance" | "availability" = "distance";
/** Markers of the stations and vehicles shown, by key of the nearby list. */
const markers = new Map<string, L.CircleMarker>();
/** Key of the item of the nearby list shown on the map. */
let selectedKey: string | null = null;

startView("MOTIS shared mobility", {
  render: (result) => {
    data = result as unknown as RentalsResult;
    hidden.clear();
    selectedKey = null;
    render(true);
  },
  themeChanged: setTheme,
});

function colors(result: RentalsResult): Map<string, string> {
  return new Map(result.providers.map((p, i) => [p.id, p.color ?? PALETTE[i % PALETTE.length]]));
}

/** Shows the providers and their stations and vehicles; [refit] the map on them. */
function render(refit: boolean): void {
  if (!data) return;
  const providerColors = colors(data);
  title.textContent = `${t("rentals.title")} · ${data.title}`;
  subtitle.textContent =
    [
      t("rentals.providers", { count: data.providers.length }),
      t("rentals.stations", { count: data.totalStations }),
      t("rentals.freeFloating", { count: data.totalVehicles }),
    ].join(" · ") +
    (data.stations.length < data.totalStations || data.vehicles.length < data.totalVehicles ? ` ${t("rentals.closestShown")}` : "");

  providersEl.innerHTML = data.providers.length
    ? data.providers.map((p) => providerLabel(p, providerColors)).join("")
    : `<span class="muted">${t("rentals.none")}</span>`;

  drawProviders(data, providerColors);
  if (refit) fit(themedMap, layer, data.bbox);
}

/**
 * Draws the stations and vehicles of the providers shown, on the map and in the nearby list: the list keeps its scroll
 * (a provider hidden or shown), its selected item when still shown.
 */
function drawProviders(result: RentalsResult, providerColors: Map<string, string>): void {
  layer.clearLayers();
  markers.clear();
  drawStations(result, providerColors);
  drawVehicles(result, providerColors);
  if (selectedKey && !markers.has(selectedKey)) selectedKey = null;
  const scroll = nearbyEl.scrollTop;
  renderNearby(result, providerColors);
  nearbyEl.scrollTop = scroll;
}

interface NearbyItem {
  key: string;
  name: string;
  detail: string;
  color: string;
  station: boolean;
  /** Distance to the center of the area in meters, when known. */
  meters?: number;
  /** Vehicles available. */
  available: number;
}

/** Center of the area asked: the stations are at their distance from it (distanceKm), the vehicles measured from it. */
function center(result: RentalsResult): L.LatLng | null {
  return result.bbox ? L.latLng((result.bbox.minLat + result.bbox.maxLat) / 2, (result.bbox.minLon + result.bbox.maxLon) / 2) : null;
}

function nearbyItems(result: RentalsResult, providerColors: Map<string, string>): NearbyItem[] {
  const names = new Map(result.providers.map((p) => [p.id, p.name]));
  const from = center(result);
  const stations: NearbyItem[] = result.stations
    .filter((s) => !hidden.has(s.providerId))
    .map((s) => ({
      key: `station:${s.id}`,
      name: s.name,
      detail:
        `${names.get(s.providerId) ?? ""} · ${t("rentals.vehicles", { count: s.vehiclesAvailable })}` +
        (s.docksAvailable != null ? ` · ${t("rentals.docks", { count: s.docksAvailable })}` : ""),
      color: providerColors.get(s.providerId) ?? "",
      station: true,
      meters: s.distanceKm != null ? s.distanceKm * 1000 : from?.distanceTo([s.lat, s.lon]),
      available: s.isRenting ? s.vehiclesAvailable : 0,
    }));
  const vehicles: NearbyItem[] = result.vehicles
    .filter((v) => !hidden.has(v.providerId))
    .map((v) => ({
      key: `vehicle:${v.id}`,
      name: `${names.get(v.providerId) ?? ""} · ${formFactor(v.formFactor)}`,
      detail: [propulsion(v.propulsion), ...(v.available ? [] : [t("rentals.unavailable")])].join(" · "),
      color: providerColors.get(v.providerId) ?? "",
      station: false,
      meters: from?.distanceTo([v.lat, v.lon]),
      available: v.available ? 1 : 0,
    }));
  const byDistance = (a: NearbyItem, b: NearbyItem) => (a.meters ?? Infinity) - (b.meters ?? Infinity);
  const byAvailability = (a: NearbyItem, b: NearbyItem) => Number(b.available > 0) - Number(a.available > 0) || byDistance(a, b);
  return [...stations, ...vehicles].sort(sort === "distance" ? byDistance : byAvailability);
}

/** List of the stations and vehicles shown on the map, closest (or available) first: shown in fullscreen. */
function renderNearby(result: RentalsResult, providerColors: Map<string, string>): void {
  nearbyEl.innerHTML = nearbyItems(result, providerColors)
    .map(
      (item) => `
      <li class="clickable ${item.key === selectedKey ? "selected" : ""}" data-key="${esc(item.key)}" tabindex="0">
        <i class="${item.station ? "station" : ""}" style="background:${esc(item.color)}"></i>
        <span class="what"><strong>${esc(item.name)}</strong><span class="muted">${esc(item.detail)}</span></span>
        <span class="muted">${item.meters == null ? "" : distance(item.meters)}</span>
      </li>`,
    )
    .join("");
}

/** Shows the station or vehicle of the item [key] of the nearby list on the map. */
function showItem(key: string): void {
  const marker = markers.get(key);
  if (!marker) return;
  selectedKey = key;
  nearbyEl.querySelectorAll<HTMLElement>("li").forEach((li) => li.classList.toggle("selected", li.dataset.key === key));
  map.setView(marker.getLatLng(), Math.max(map.getZoom(), 17));
  marker.openTooltip();
}

const itemKey = (e: Event) => (e.target as HTMLElement).closest<HTMLElement>("li[data-key]")?.dataset.key;
nearbyEl.addEventListener("click", (e) => {
  const key = itemKey(e);
  if (key) showItem(key);
});
nearbyEl.addEventListener("keydown", (e) => {
  const key = itemKey(e);
  if (key && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    showItem(key);
  }
});

content.querySelectorAll<HTMLButtonElement>("button[data-sort]").forEach((button) =>
  button.addEventListener("click", () => {
    sort = button.dataset.sort === "availability" ? "availability" : "distance";
    content.querySelectorAll("button[data-sort]").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
    if (data) renderNearby(data, colors(data));
  }),
);

function providerLabel(p: RentalsResult["providers"][number], providerColors: Map<string, string>): string {
  const formFactors = p.formFactors.map(formFactor).join(", ");
  const areaVehicles = p.areaVehicles ? ` · ${t("rentals.areaVehicles", { count: p.areaVehicles })}` : "";
  return `
      <label class="chip-toggle" title="${esc(p.operator ?? "")}">
        <input type="checkbox" data-provider="${esc(p.id)}" ${hidden.has(p.id) ? "" : "checked"} />
        <i style="background:${esc(providerColors.get(p.id))}"></i>${esc(p.name)}
        <span class="muted">${formFactors} · ${t("rentals.providerCounts", { stations: p.stations, vehicles: p.vehicles })}${areaVehicles}</span>
      </label>`;
}

function drawStations(data: RentalsResult, providerColors: Map<string, string>): void {
  for (const s of data.stations) {
    if (hidden.has(s.providerId)) continue;
    const marker = L.circleMarker([s.lat, s.lon], {
      radius: 4 + Math.min(8, Math.sqrt(s.vehiclesAvailable) * 1.5),
      color: providerColors.get(s.providerId),
      weight: 2,
      fillColor: providerColors.get(s.providerId),
      fillOpacity: s.vehiclesAvailable > 0 ? 0.6 : 0.1,
    })
      .bindTooltip(
        `<strong>${esc(s.name)}</strong><br>${t("rentals.vehicles", { count: s.vehiclesAvailable })}` +
          (s.docksAvailable != null ? ` · ${t("rentals.docks", { count: s.docksAvailable })}` : "") +
          (s.distanceKm != null ? ` · ${Math.round(s.distanceKm * 1000)} m` : "") +
          (s.isRenting ? "" : `<br>${t("rentals.notRenting")}`),
      )
      .addTo(layer);
    markers.set(`station:${s.id}`, marker);
  }
}

function drawVehicles(data: RentalsResult, providerColors: Map<string, string>): void {
  for (const v of data.vehicles) {
    if (hidden.has(v.providerId)) continue;
    const marker = L.circleMarker([v.lat, v.lon], {
      radius: 3,
      stroke: false,
      fillColor: providerColors.get(v.providerId),
      fillOpacity: v.available ? 0.9 : 0.3,
    })
      .bindTooltip(
        [formFactor(v.formFactor), propulsion(v.propulsion), ...(v.available ? [] : [t("rentals.unavailable")])]
          .map(esc)
          .join(" · "),
      )
      .addTo(layer);
    markers.set(`vehicle:${v.id}`, marker);
  }
}

providersEl.addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  const id = input.dataset.provider;
  if (!id) return;
  if (input.checked) hidden.delete(id);
  else hidden.add(id);
  // the providers are left as they are (the checkbox keeps the focus): only their stations and vehicles change
  if (data) drawProviders(data, colors(data));
});

const style = document.createElement("style");
style.textContent = `
  .rentals { display: flex; flex-direction: column; gap: 12px; }
  .rentals .side { display: contents; }

  /* fullscreen: the providers and the nearby list in a side bar, the map beside it; on a phone, the map above */
  :root[data-display-mode="fullscreen"] .rentals { flex: 1; min-height: 0; display: grid; gap: 10px;
    grid-template-columns: minmax(260px, 320px) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); }
  :root[data-display-mode="fullscreen"] .rentals .side { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
  :root[data-display-mode="fullscreen"] #providers { flex-direction: column; align-items: stretch; flex-wrap: nowrap;
    max-height: 40%; overflow-y: auto; padding: 1px; }
  :root[data-display-mode="fullscreen"] #providers .chip-toggle { flex: none; border-radius: var(--border-radius-md); flex-wrap: wrap; }
  .nearby { display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 0; }
  .nearby-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; }
  .nearby .list { overflow-y: auto; padding: 1px; }
  .nearby .list > li { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 8px 10px; }
  .nearby .list > li:focus-visible { outline: none; box-shadow: var(--focus-ring); }
  .nearby i { width: 10px; height: 10px; border-radius: 50%; }
  .nearby i.station { border-radius: 3px; }
  .nearby .what { display: flex; flex-direction: column; min-width: 0; }
  .nearby .what > * { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @media (max-width: 640px) {
    :root[data-display-mode="fullscreen"] .rentals { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 55fr) minmax(0, 45fr); }
    :root[data-display-mode="fullscreen"] .rentals .side { order: 1; }
  }
`;
document.head.appendChild(style);
