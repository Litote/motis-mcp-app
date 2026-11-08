import L from "leaflet";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "./i18n";
import { type Feature, type LineSymbolizer, type PaintRule, labelRules } from "protomaps-leaflet";
import { basemapPaintRules, createMap, railLayer, type RailOverlay } from "./map";

// vector tiles: an empty grid layer keeping the options of protomaps-leaflet (no tile download nor drawing)
vi.mock("protomaps-leaflet", async (importOriginal) => {
  const { default: Leaflet } = await import("leaflet");
  const original = await importOriginal<typeof import("protomaps-leaflet")>();
  return {
    ...original,
    labelRules: vi.fn(original.labelRules),
    leafletLayer: (options: Record<string, unknown>) => Object.assign(Leaflet.gridLayer(), { protomaps: options }),
  };
});

const railway = (props: Record<string, unknown>) => ({ props: { kind: "rail", ...props } }) as unknown as Feature;
const railwayRules = (rules: PaintRule[]) =>
  rules.filter((rule) => rule.dataLayer === "roads" && rule.filter?.(15, railway({ kind_detail: "rail" })));

describe("basemapPaintRules", () => {
  it("draws the main railways in the open as a plain line, instead of every railway in faint dashes", () => {
    const [rule, ...others] = railwayRules(basemapPaintRules("light"));

    expect(others).toEqual([]);
    const symbolizer = rule.symbolizer as LineSymbolizer;
    expect(symbolizer.dash).toBeNull();
    expect(symbolizer.color.get(15)).toBe("#1f1f1f");
    expect(symbolizer.width.get(11)).toBeLessThan(symbolizer.width.get(18));
    expect(rule.filter!(15, railway({ kind_detail: "light_rail", is_bridge: true }))).toBe(true);
    for (const props of [
      { kind_detail: "subway" },
      { kind_detail: "tram" },
      { kind_detail: "rail", is_tunnel: true },
      { kind_detail: "rail", service: "siding" },
      { kind: "highway", kind_detail: "motorway" },
    ]) {
      expect(rule.filter!(15, railway(props))).toBe(false);
    }
  });

  it("draws the railways in a light color in dark theme", () => {
    const [rule] = railwayRules(basemapPaintRules("dark"));

    expect((rule.symbolizer as LineSymbolizer).color.get(15)).toBe("#d4d4d4");
  });
});

const IGN: RailOverlay = {
  url: "https://data.geopf.fr/wmts?TILEMATRIX={z}&TILEROW={y}&TILECOL={x}",
  attribution: "IGN",
  area: "france",
  minZoom: 6,
  maxNativeZoom: 18,
};
const ORM: RailOverlay = {
  url: "https://tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png",
  attribution: "OpenRailwayMap",
  area: "world",
  minZoom: 0,
  maxNativeZoom: 19,
};

const coords = (x: number, y: number, z: number) => Object.assign(L.point(x, y), { z }) as L.Coords;
// Paris at zoom 12 and 5, Brussels at zoom 12
const PARIS = coords(2074, 1409, 12);
const PARIS_Z5 = coords(16, 11, 5);
const BRUSSELS = coords(2097, 1371, 12);

describe("railLayer", () => {
  it("is null without any overlay", () => {
    expect(railLayer([])).toBeNull();
  });

  it("takes the French overlay in France from its minimum zoom, the world one elsewhere", () => {
    const layer = railLayer([ORM, IGN])!;

    expect(layer.getTileUrl(PARIS)).toBe("https://data.geopf.fr/wmts?TILEMATRIX=12&TILEROW=1409&TILECOL=2074");
    expect(layer.getTileUrl(BRUSSELS)).toBe("https://tiles.openrailwaymap.org/standard/12/2097/1371.png");
    expect(layer.getTileUrl(PARIS_Z5)).toBe("https://tiles.openrailwaymap.org/standard/5/16/11.png");
    expect(layer.options.maxNativeZoom).toBe(18);
    expect(layer.options.pane).toBe("rails");
    expect(layer.getAttribution?.()).toBe("IGN · OpenRailwayMap");
  });

  it("marks the French tiles, inverted in dark theme", () => {
    // createTile is protected in the typings of Leaflet
    const layer = railLayer([IGN, ORM]) as unknown as { createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement };
    const done = () => undefined;

    expect(layer.createTile(PARIS, done).classList.contains("rail-france")).toBe(true);
    expect(layer.createTile(BRUSSELS, done).classList.contains("rail-france")).toBe(false);
  });

  it("limits a single French overlay to France", () => {
    const layer = railLayer([IGN])!;

    expect(layer.options.minZoom).toBe(6);
    expect(layer.options.className).toBe("rail-france");
    expect((layer.options.bounds as L.LatLngBounds).contains(L.latLng(48.8566, 2.3522))).toBe(true);
    expect((layer.options.bounds as L.LatLngBounds).contains(L.latLng(52.52, 13.405))).toBe(false);
  });

  it("keeps only the French overlay over the vector maps, below their railways, as plain lines", () => {
    const layer = railLayer([ORM, IGN], true)!;

    expect(layer.options.minZoom).toBe(6);
    expect(layer.options.maxZoom).toBe(11);
    expect(layer.options.className).toBe("rail-mono");
    expect(layer.options.opacity).toBe(0.7);
    expect(layer.getAttribution?.()).toBe("IGN");
    expect((layer.options.bounds as L.LatLngBounds).contains(L.latLng(48.8566, 2.3522))).toBe(true);
    expect(railLayer([ORM], true)).toBeNull();
  });

  it("draws a single world overlay everywhere", () => {
    const layer = railLayer([ORM])!;

    expect(layer.options.bounds).toBeNull();
    expect(layer.options.className).toBe("");
    expect(layer.getAttribution?.()).toBe("OpenRailwayMap");
  });
});

describe("createMap", () => {
  afterEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  const mapElement = () => {
    const element = document.createElement("div");
    document.body.append(element);
    return element;
  };

  it("draws the tiles and the rail overlays of the server configuration", () => {
    const config = { tiles: { url: "https://tiles.example.org/{z}/{x}/{y}.png", attribution: "Example" }, railOverlays: [IGN, ORM] };
    document.head.innerHTML = `<script type="application/json" id="motis-map">${JSON.stringify(config)}</script>`;

    const { map } = createMap(mapElement());

    const layers: L.TileLayer[] = [];
    map.eachLayer((layer) => {
      if (layer instanceof L.TileLayer) layers.push(layer);
    });
    expect(layers.map((l) => l.options.pane)).toEqual(["tilePane", "rails"]);
    // once on the map, the zoom of the URL is the one of the map (5)
    expect(layers[0].getTileUrl(PARIS)).toBe("https://tiles.example.org/5/2074/1409.png");
    expect(map.getPane("rails")!.style.zIndex).toBe("250");
  });

  it("falls back on OpenStreetMap without configuration, or with an invalid one", () => {
    for (const head of ["", '<script type="application/json" id="motis-map">{</script>']) {
      document.head.innerHTML = head;
      const { map } = createMap(mapElement());

      const urls: string[] = [];
      map.eachLayer((layer) => {
        if (layer instanceof L.TileLayer) urls.push(layer.getTileUrl(PARIS));
      });
      expect(urls).toEqual(["https://tile.openstreetmap.org/5/2074/1409.png"]);
      expect(map.getPane("rails")).toBeUndefined();
    }
  });

  it("draws the vector tiles in the theme and the language of the host, instead of the raster tiles", () => {
    const config = {
      tiles: { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: "OSM" },
      vectorTiles: { url: "https://api.protomaps.com/tiles/v4/{z}/{x}/{y}.mvt?key=abc", attribution: "Protomaps" },
      railOverlays: [IGN],
    };
    document.head.innerHTML = `<script type="application/json" id="motis-map">${JSON.stringify(config)}</script>`;
    setLocale("fr-FR");
    const element = mapElement();

    const { map, setTheme } = createMap(element);
    const vectorLayers = () => {
      const layers: Array<Record<string, unknown>> = [];
      map.eachLayer((layer) => {
        if ("protomaps" in layer) layers.push(layer.protomaps as Record<string, unknown>);
      });
      return layers;
    };
    const rasterLayers = () => {
      let count = 0;
      map.eachLayer((layer) => {
        if (layer instanceof L.TileLayer && layer.options.pane === "tilePane") count++;
      });
      return count;
    };

    expect(element.classList.contains("vector-tiles")).toBe(true);
    expect(rasterLayers()).toBe(0);
    expect(vectorLayers()).toMatchObject([
      { url: config.vectorTiles.url, backgroundColor: "#cccccc", maxDataZoom: 15, attribution: expect.stringMatching(/^Protomaps · /) },
    ]);
    // labels in the language of the host
    expect(labelRules).toHaveBeenLastCalledWith(expect.objectContaining({ background: "#cccccc" }), "fr");
    expect(map.getPane("rails")).toBeDefined();
    const overlays: L.TileLayer[] = [];
    map.eachLayer((layer) => {
      if (layer instanceof L.TileLayer && layer.options.pane === "rails") overlays.push(layer);
    });
    expect(overlays.map((o) => [o.options.className, o.options.maxZoom])).toEqual([["rail-mono", 11]]);

    setTheme("dark");
    expect(vectorLayers()).toMatchObject([{ backgroundColor: "#34373d" }]);
    expect(element.classList.contains("dark-tiles")).toBe(true);
    setTheme("dark");
    expect(vectorLayers()).toHaveLength(1);
    setLocale(undefined);
  });
});
