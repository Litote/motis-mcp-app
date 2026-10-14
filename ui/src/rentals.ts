// Shared mobility (rentals): providers, stations and free-floating vehicles on a map.
import L from "leaflet";
import { startView } from "./shared/app";
import { esc } from "./shared/format";
import { t, tOptional } from "./shared/i18n";
import { createMap, fit } from "./shared/map";
import type { RentalsResult } from "./shared/types";

const title = document.getElementById("title")!;
const subtitle = document.getElementById("subtitle")!;
const content = document.getElementById("content")!;
content.innerHTML = `
  <div id="providers" class="legend"></div>
  <div id="map" class="map"></div>`;

const providersEl = document.getElementById("providers")!;
const themedMap = createMap(document.getElementById("map")!);
const { map, setTheme } = themedMap;
const layer = L.featureGroup().addTo(map);

const PALETTE = ["#1c7ed6", "#e8590c", "#2f9e44", "#ae3ec9", "#f08c00", "#0c8599", "#c2255c", "#5f3dc4"];
const formFactor = (f: string): string => tOptional(`formFactor.${f}`) ?? f.toLowerCase();
const propulsion = (p: string): string => tOptional(`propulsion.${p}`) ?? p.toLowerCase();

let data: RentalsResult | null = null;
const hidden = new Set<string>();

startView("MOTIS shared mobility", {
  render: (result) => {
    data = result as unknown as RentalsResult;
    hidden.clear();
    render(true);
  },
  themeChanged: setTheme,
});

function colors(result: RentalsResult): Map<string, string> {
  return new Map(result.providers.map((p, i) => [p.id, p.color ?? PALETTE[i % PALETTE.length]]));
}

function render(refit: boolean): void {
  if (!data) return;
  const providerColors = colors(data);
  title.textContent = `${t("rentals.title")} · ${data.title}`;
  subtitle.textContent =
    t("rentals.summary", { providers: data.providers.length, stations: data.totalStations, vehicles: data.totalVehicles }) +
    (data.stations.length < data.totalStations || data.vehicles.length < data.totalVehicles ? ` ${t("rentals.closestShown")}` : "");

  providersEl.innerHTML = data.providers.length
    ? data.providers.map((p) => providerLabel(p, providerColors)).join("")
    : `<span class="muted">${t("rentals.none")}</span>`;

  layer.clearLayers();
  drawStations(data, providerColors);
  drawVehicles(data, providerColors);
  if (refit) fit(themedMap, layer, data.bbox);
}

function providerLabel(p: RentalsResult["providers"][number], providerColors: Map<string, string>): string {
  const formFactors = p.formFactors.map(formFactor).join(", ");
  const areaVehicles = p.areaVehicles ? ` · ${t("rentals.areaVehicles", { count: p.areaVehicles })}` : "";
  return `
      <label title="${esc(p.operator ?? "")}">
        <input type="checkbox" data-provider="${esc(p.id)}" ${hidden.has(p.id) ? "" : "checked"} />
        <i style="background:${esc(providerColors.get(p.id))}"></i>${esc(p.name)}
        <span class="muted">${formFactors} · ${t("rentals.providerCounts", { stations: p.stations, vehicles: p.vehicles })}${areaVehicles}</span>
      </label>`;
}

function drawStations(data: RentalsResult, providerColors: Map<string, string>): void {
  for (const s of data.stations) {
    if (hidden.has(s.providerId)) continue;
    L.circleMarker([s.lat, s.lon], {
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
  }
}

function drawVehicles(data: RentalsResult, providerColors: Map<string, string>): void {
  for (const v of data.vehicles) {
    if (hidden.has(v.providerId)) continue;
    L.circleMarker([v.lat, v.lon], {
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
  }
}

providersEl.addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  const id = input.dataset.provider;
  if (!id) return;
  if (input.checked) hidden.delete(id);
  else hidden.add(id);
  render(false);
});
