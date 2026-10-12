// Shared mobility (rentals): providers, stations and free-floating vehicles on a map.
import L from "leaflet";
import { startView } from "./shared/app";
import { esc } from "./shared/format";
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
const FORM_FACTORS: Record<string, string> = {
  BICYCLE: "bike",
  CARGO_BICYCLE: "cargo bike",
  CAR: "car",
  MOPED: "moped",
  SCOOTER_STANDING: "scooter",
  SCOOTER_SEATED: "seated scooter",
  OTHER: "other",
};

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
  title.textContent = `Shared mobility · ${data.title}`;
  subtitle.textContent =
    `${data.providers.length} provider(s) · ${data.totalStations} station(s) or parking spot(s) · ` +
    `${data.totalVehicles} free-floating vehicle(s)` +
    (data.stations.length < data.totalStations || data.vehicles.length < data.totalVehicles ? " (closest shown)" : "");

  providersEl.innerHTML = data.providers.length
    ? data.providers
        .map(
          (p) => `
      <label title="${esc(p.operator ?? "")}">
        <input type="checkbox" data-provider="${esc(p.id)}" ${hidden.has(p.id) ? "" : "checked"} />
        <i style="background:${esc(providerColors.get(p.id))}"></i>${esc(p.name)}
        <span class="muted">${p.formFactors.map((f) => FORM_FACTORS[f] ?? f.toLowerCase()).join(", ")} · ${p.stations} st. · ${p.vehicles} veh.${p.areaVehicles ? ` · ${p.areaVehicles} in its whole area` : ""}</span>
      </label>`,
        )
        .join("")
    : '<span class="muted">No shared mobility provider in this area.</span>';

  layer.clearLayers();
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
        `<strong>${esc(s.name)}</strong><br>${s.vehiclesAvailable} vehicle(s)` +
          (s.docksAvailable != null ? ` · ${s.docksAvailable} free dock(s)` : "") +
          (s.distanceKm != null ? ` · ${Math.round(s.distanceKm * 1000)} m` : "") +
          (s.isRenting ? "" : "<br>not renting"),
      )
      .addTo(layer);
  }
  for (const v of data.vehicles) {
    if (hidden.has(v.providerId)) continue;
    L.circleMarker([v.lat, v.lon], {
      radius: 3,
      stroke: false,
      fillColor: providerColors.get(v.providerId),
      fillOpacity: v.available ? 0.9 : 0.3,
    })
      .bindTooltip(`${esc(FORM_FACTORS[v.formFactor] ?? v.formFactor)} · ${esc(v.propulsion.toLowerCase())}${v.available ? "" : " · unavailable"}`)
      .addTo(layer);
  }
  if (refit) fit(themedMap, layer, data.bbox);
}

providersEl.addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  const id = input.dataset.provider;
  if (!id) return;
  if (input.checked) hidden.delete(id);
  else hidden.add(id);
  render(false);
});
