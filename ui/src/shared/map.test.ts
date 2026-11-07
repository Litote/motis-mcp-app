import L from "leaflet";
import { afterEach, describe, expect, it } from "vitest";
import { createMap, railLayer, type RailOverlay } from "./map";

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
});
