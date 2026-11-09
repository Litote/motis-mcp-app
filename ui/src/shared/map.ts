// Leaflet map, with raster tiles or vector tiles drawn on canvas (protomaps-leaflet): no web worker nor WebGL, which
// keeps it working in the host sandbox.
import polyline from "@mapbox/polyline";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { namedFlavor } from "@protomaps/basemaps";
import { type Feature, labelRules, leafletLayer, LineSymbolizer, linear, type PaintRule, paintRules } from "protomaps-leaflet";
import { currentTheme } from "./app";
import { FRANCE_BOUNDS, tileInsideFrance } from "./france";
import { hostLocale } from "./i18n";

// protomaps-leaflet extends the global L when its layer is created
(globalThis as { L?: typeof L }).L ??= L;

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

/** Transparent raster tiles of the railways, drawn over the map: the French ones in France, the world ones elsewhere. */
export interface RailOverlay {
  url: string;
  attribution: string;
  area: "france" | "world";
  minZoom: number;
  maxNativeZoom: number;
}

export interface TileSource {
  url: string;
  attribution: string;
}

export interface MapConfig {
  /** Raster tiles, used without vector tiles. */
  tiles: TileSource;
  /** Vector tiles of the Protomaps basemap schema (`…/{z}/{x}/{y}.mvt`), drawn in the theme of the host. */
  vectorTiles?: TileSource | null;
  railOverlays: RailOverlay[];
}

const DEFAULT_CONFIG: MapConfig = {
  tiles: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  vectorTiles: null,
  railOverlays: [],
};

/** Last zoom of the maps. */
const MAX_ZOOM = 19;

/** Last zoom of the Protomaps basemap tiles: zoomed in beyond. */
const VECTOR_MAX_DATA_ZOOM = 15;

/** Map configuration of the server (`<script type="application/json" id="motis-map">`), OpenStreetMap by default. */
function mapConfig(): MapConfig {
  const json = document.getElementById("motis-map")?.textContent;
  if (!json) return DEFAULT_CONFIG;
  try {
    const config = JSON.parse(json) as Partial<MapConfig>;
    return {
      tiles: config.tiles ?? DEFAULT_CONFIG.tiles,
      vectorTiles: config.vectorTiles ?? null,
      railOverlays: config.railOverlays ?? [],
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

/** Pane of the rail overlay: above the tiles (200), below the itineraries and markers (400), out of the dark filter. */
const RAIL_PANE = "rails";

/** Class of the French overlay tiles: inverted in dark theme, like the map (dark lines). */
const FRENCH_TILE_CLASS = "rail-france";

/** Tile layer choosing, per tile, the French overlay for the tiles entirely in France, else the world one. */
class RailTileLayer extends L.TileLayer {
  constructor(
    private readonly france: RailOverlay,
    private readonly world: RailOverlay,
    options: L.TileLayerOptions,
  ) {
    super(world.url, options);
  }

  private french({ x, y, z }: L.Coords): boolean {
    return z >= this.france.minZoom && tileInsideFrance(z, x, y);
  }

  override getTileUrl(coords: L.Coords): string {
    const { x, y, z } = coords;
    return L.Util.template((this.french(coords) ? this.france : this.world).url, { x, y, z });
  }

  override createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const tile = super.createTile(coords, done);
    tile.classList.toggle(FRENCH_TILE_CLASS, this.french(coords));
    return tile;
  }
}

/** Class of the overlay tiles drawn as a plain line, in the color of the railways of the vector maps. */
const MONO_TILE_CLASS = "rail-mono";

/** First zoom of the map with railways in the vector tiles (none below zoom 11 in the data, drawn one zoom below). */
const VECTOR_RAILWAYS_MIN_ZOOM = 12;

/**
 * Layer of the rail overlays (null without any): both areas combined per tile, or a single one.
 *
 * Over the [vector] maps, which draw the railways from zoom 12, only the French overlay (plain lines) is kept, below:
 * recolored like the railways of the vector maps (the world one has colors and labels).
 */
export function railLayer(overlays: RailOverlay[], vector = false): L.TileLayer | null {
  if (vector) {
    const overlay = overlays.find((o) => o.area === "france");
    return overlay
      ? L.tileLayer(overlay.url, {
          pane: RAIL_PANE,
          attribution: overlay.attribution,
          minZoom: overlay.minZoom,
          maxZoom: VECTOR_RAILWAYS_MIN_ZOOM - 1,
          maxNativeZoom: overlay.maxNativeZoom,
          bounds: L.latLngBounds(FRANCE_BOUNDS),
          className: MONO_TILE_CLASS,
          // the IGN lines are thicker than the ones of the vector maps
          opacity: 0.7,
        })
      : null;
  }
  const france = overlays.find((o) => o.area === "france");
  const world = overlays.find((o) => o.area === "world");
  if (!france && !world) return null;
  const options: L.TileLayerOptions = {
    pane: RAIL_PANE,
    attribution: [france, world].flatMap((o) => (o ? [o.attribution] : [])).join(" · "),
    maxZoom: MAX_ZOOM,
    opacity: 0.85,
  };
  if (france && world) {
    return new RailTileLayer(france, world, {
      ...options,
      maxNativeZoom: Math.min(france.maxNativeZoom, world.maxNativeZoom),
    });
  }
  const overlay = (france ?? world)!;
  return L.tileLayer(overlay.url, {
    ...options,
    minZoom: overlay.minZoom,
    maxNativeZoom: overlay.maxNativeZoom,
    ...(overlay.area === "france" ? { bounds: L.latLngBounds(FRANCE_BOUNDS), className: FRENCH_TILE_CLASS } : {}),
  });
}

export interface ThemedMap {
  map: L.Map;
  setTheme(theme: "light" | "dark"): void;
  /** Shows [bounds]; they are shown again when the map is resized (host layout, fullscreen). */
  show(bounds: L.LatLngBounds): void;
}

/**
 * Color of the railways: like the roads, a plain line contrasting with the background (black in light theme). Also the
 * color of the `.rail-mono` overlay tiles below zoom 12 (style.css).
 */
const RAILWAY_COLORS = { light: "#1f1f1f", dark: "#d4d4d4" };

/** Railways drawn by the basemap: the main lines in the open, not the subway, tramways, tunnels nor service tracks. */
const MAIN_RAILWAYS = new Set(["rail", "light_rail", "narrow_gauge"]);

function mainRailway(feature: Feature): boolean {
  const { kind, kind_detail: detail, is_tunnel: tunnel, service } = feature.props;
  return kind === "rail" && typeof detail === "string" && MAIN_RAILWAYS.has(detail) && !tunnel && !service;
}

/** Railway rule of the Protomaps flavor: all the railways in faint dashes. */
function protomapsRailway(rule: PaintRule): boolean {
  return rule.dataLayer === "roads" && (rule.filter?.(15, { props: { kind: "rail" } } as unknown as Feature) ?? false);
}

/**
 * Paint rules of the Protomaps flavor of the [theme], the railways being the main lines only, as a plain line (in place
 * of the faint dashes of every railway).
 */
export function basemapPaintRules(theme: "light" | "dark"): PaintRule[] {
  const railway: PaintRule = {
    dataLayer: "roads",
    symbolizer: new LineSymbolizer({
      color: RAILWAY_COLORS[theme],
      // thin enough for the tracks of the stations to stay distinct at street level (no railway below zoom 11 in the
      // tiles: the French overlay draws them below, see railLayer)
      width: linear([
        [11, 1],
        [13, 1.2],
        [15, 1.4],
        [18, 2],
      ]),
    }),
    filter: (_, feature) => mainRailway(feature),
  };
  const rules = paintRules(namedFlavor(theme));
  const index = rules.findIndex(protomapsRailway);
  return index < 0 ? [...rules, railway] : rules.map((rule) => (protomapsRailway(rule) ? railway : rule));
}

/** Layer of the vector tiles, in the [theme] (Protomaps flavor) and the language of the host. */
export function vectorLayer(source: TileSource, theme: "light" | "dark"): L.GridLayer {
  const flavor = namedFlavor(theme);
  return leafletLayer({
    url: source.url,
    paintRules: basemapPaintRules(theme),
    labelRules: labelRules(flavor, hostLocale()?.split("-")[0] ?? "en"),
    backgroundColor: flavor.background,
    maxDataZoom: VECTOR_MAX_DATA_ZOOM,
    maxZoom: MAX_ZOOM,
    attribution: `${source.attribution} · ${DATA_ATTRIBUTION}`,
  }) as unknown as L.GridLayer;
}

/**
 * Creates a map. In dark theme, the vector tiles are drawn in their dark flavor, the raster tiles inverted with a CSS
 * filter; the French rail overlay is inverted in both cases.
 */
export function createMap(element: HTMLElement): ThemedMap {
  // zoom range of the map itself: else Leaflet takes it from the layers, and the rail overlay (from zoom 6, or below
  // zoom 12 over the vector maps) would clamp the map with an animated zoom, during which fitBounds is ignored
  const map = L.map(element, { zoomControl: true, preferCanvas: true, minZoom: 0, maxZoom: MAX_ZOOM }).setView([46.5, 2.5], 5);
  const { tiles, vectorTiles, railOverlays } = mapConfig();
  let vector: { layer: L.GridLayer; theme: "light" | "dark" } | null = null;
  if (vectorTiles) {
    element.classList.add("vector-tiles");
  } else {
    L.tileLayer(tiles.url, { attribution: `${tiles.attribution} · ${DATA_ATTRIBUTION}`, maxZoom: MAX_ZOOM }).addTo(map);
  }
  const rails = railLayer(railOverlays, vectorTiles != null);
  if (rails) {
    const pane = map.createPane(RAIL_PANE);
    pane.style.zIndex = "250";
    pane.style.pointerEvents = "none";
    rails.addTo(map);
  }
  const setTheme = (theme: "light" | "dark") => {
    element.classList.toggle("dark-tiles", theme === "dark");
    if (vectorTiles && vector?.theme !== theme) {
      vector?.layer.remove();
      vector = { layer: vectorLayer(vectorTiles, theme).addTo(map), theme };
    }
  };
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
  if (layer.getLayers().length > 0) {
    const b = layer.getBounds();
    if (b.isValid()) map.show(b);
  } else if (fallback) {
    map.show(bounds(fallback));
  }
}
