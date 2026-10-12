// Leaflet map with raster tiles: no web worker nor WebGL, which keeps it working in the host sandbox.
import polyline from "@mapbox/polyline";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { currentTheme } from "./app";

export interface Polyline {
  points: string;
  precision: number;
}

export interface Bbox {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

const DATA_ATTRIBUTION = 'data <a href="https://transitous.org/sources/">Transitous</a>';

/** Tiles configured by the server (`<meta name="motis-tiles">`), OpenStreetMap by default. */
function tiles(): { url: string; attribution: string } {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="motis-tiles"]');
  return {
    url: meta?.content || "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution:
      meta?.dataset.attribution || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  };
}

export interface ThemedMap {
  map: L.Map;
  setTheme(theme: "light" | "dark"): void;
  /** Shows [bounds]; they are shown again when the map is resized (host layout, fullscreen). */
  show(bounds: L.LatLngBounds): void;
}

/** Creates a map; in dark theme, the raster tiles are inverted with a CSS filter. */
export function createMap(element: HTMLElement): ThemedMap {
  const map = L.map(element, { zoomControl: true, preferCanvas: true }).setView([46.5, 2.5], 5);
  const { url, attribution } = tiles();
  L.tileLayer(url, { attribution: `${attribution} · ${DATA_ATTRIBUTION}`, maxZoom: 19 }).addTo(map);
  const setTheme = (theme: "light" | "dark") => element.classList.toggle("dark-tiles", theme === "dark");
  setTheme(currentTheme());
  let shown: L.LatLngBounds | null = null;
  const show = (b: L.LatLngBounds) => {
    shown = b;
    if (element.clientWidth > 0 && element.clientHeight > 0) map.fitBounds(b, { padding: [24, 24], maxZoom: 16 });
  };
  // the container may be sized after the data is shown (host layout)
  new ResizeObserver(() => {
    map.invalidateSize();
    if (shown) show(shown);
  }).observe(element);
  // once the user moves or zooms the map, it is no longer reset on resize
  for (const type of ["pointerdown", "wheel"]) element.addEventListener(type, () => (shown = null), { passive: true });
  return { map, setTheme, show };
}

export function decode(p: Polyline): L.LatLngExpression[] {
  return polyline.decode(p.points, p.precision) as L.LatLngExpression[];
}

export function bounds(b: Bbox): L.LatLngBounds {
  return L.latLngBounds([b.minLat, b.minLon], [b.maxLat, b.maxLon]);
}

/** Shows [layer] when it is not empty, else [fallback]. */
export function fit(map: ThemedMap, layer: L.FeatureGroup, fallback?: Bbox | null): void {
  const b = layer.getLayers().length > 0 ? layer.getBounds() : fallback ? bounds(fallback) : null;
  if (b?.isValid()) map.show(b);
}
