import { describe, expect, it } from "vitest";
import { $, fixture, flush, loadView } from "./test/host";
import type { AreaResult, DeparturesResult } from "./shared/types";

const texts = (selector: string) => [...document.querySelectorAll(selector)].map((el) => el.textContent!.trim());

describe("explorer view", () => {
  it("shows the stops and routes of an area", async () => {
    const app = await loadView("explorer");
    await app.toolResult({ place: "45.7605,4.8597" }, fixture("area"));

    expect($("#title").textContent).toBe("45.7605,4.8597 (0.5 km)");
    expect($("#subtitle").textContent).toBe("12 stops · 4 routes");
    // routes as chips, in the order of the server
    expect(texts("#chips [data-route]")).toEqual(["AVE INT", "A", "125", "High-speed"]);
    expect([...document.querySelectorAll<HTMLElement>("#chips [data-route]")].map((el) => el.dataset.route)).toEqual([
      "803145",
      "942270",
      "940073",
      "915397",
    ]);
    expect(texts("#legend span")).toEqual(["High-speed", "Metro", "Bus"]);
    expect($("#back").hidden).toBe(true);
  });

  it("explains the partial areas", async () => {
    const app = await loadView("explorer");
    const area = fixture<AreaResult>("area");
    await app.toolResult({}, { ...area, stops: area.stops.slice(0, 2), zoomFiltered: true });

    expect($("#subtitle").textContent).toBe("12 stops · 4 routes (2 stops shown) · minor routes hidden, zoom in");
  });

  it("opens a route from its chip, and goes back to the area", async () => {
    const app = await loadView("explorer");
    await app.toolResult({}, fixture("area"));
    app.answer(fixture("route"));

    $("#chips [data-route='940073']").click();
    await flush();

    expect(app.callServerTool).toHaveBeenLastCalledWith({ name: "route_details", arguments: { routeIdx: 940073 } });
    expect($("#title").textContent).toBe("TRAM T4");
    expect($("#chips").innerHTML).toBe("");
    expect($("#back").hidden).toBe(false);

    $("#back").click();
    expect($("#title").textContent).toBe("45.7605,4.8597 (0.5 km)");
    expect($("#back").hidden).toBe(true);
  });

  it("reports a failed route", async () => {
    const app = await loadView("explorer");
    await app.toolResult({}, fixture("area"));
    app.answer(new Error("MOTIS error: unknown route"));

    $("#chips [data-route='940073']").click();
    await flush();

    expect($("#status").textContent).toBe("MOTIS error: unknown route");
    expect($("#title").textContent).toBe("45.7605,4.8597 (0.5 km)");
  });

  it("shows an isochrone, colored by travel time", async () => {
    const app = await loadView("explorer");
    await app.toolResult({}, fixture("reachability"));

    expect($("#title").textContent).toBe("Reachable from ");
    expect($("#subtitle").textContent).toBe("56 stops within 10 min");
    expect(texts("#legend span")).toEqual(["0 min", "3 min", "5 min", "8 min", "10 min"]);
  });

  it("opens a route from its shape on the map", async () => {
    const app = await loadView("explorer");
    const clicks = await layerClicks();
    await app.toolResult({}, fixture("area"));
    app.answer(fixture("route"));

    // shapes first (one per polyline), then the stops
    clicks[1]();
    await flush();

    expect(app.callServerTool).toHaveBeenLastCalledWith({ name: "route_details", arguments: { routeIdx: 803145 } });
  });

  it("shows the next departures of a stop in a popup", async () => {
    const app = await loadView("explorer");
    const clicks = await layerClicks();
    await app.toolResult({}, fixture("area"));
    const departures = fixture<DeparturesResult>("departures");
    app.answer(departures, { ...departures, stopTimes: [] }, new Error("MOTIS error: timeout"));
    // the first stop: LYON-PART-DIEU
    const openStop = clicks[3];

    const popup = async () => {
      openStop();
      await flush();
      return document.querySelector(".leaflet-popup-content")?.textContent ?? "";
    };

    expect(await popup()).toMatch(/^LYON-PART-DIEU23:16TGV INOUI 6633Lyon Perrache/);
    expect(app.callServerTool).toHaveBeenLastCalledWith({ name: "departures", arguments: { stopId: "it-trenitalia_870072319", count: 8 } });
    expect(await popup()).toBe("LYON-PART-DIEUNo departure soon");
    expect(await popup()).toBe("LYON-PART-DIEUMOTIS error: timeout");
  });
});

/**
 * Click handlers of the shapes and markers drawn by the view, in creation order: the canvas of the map cannot be
 * clicked in jsdom. Leaflet is the instance of the loaded view.
 */
async function layerClicks(): Promise<(() => void)[]> {
  const { default: L } = await import("leaflet");
  const clicks: (() => void)[] = [];
  const on = L.Layer.prototype.on;
  L.Layer.prototype.on = function (this: L.Layer, type: unknown, handler?: unknown, ...rest: unknown[]) {
    if (type === "click" && typeof handler === "function") clicks.push(handler as () => void);
    return (on as (...args: unknown[]) => L.Layer).call(this, type, handler, ...rest);
  } as typeof on;
  return clicks;
}
