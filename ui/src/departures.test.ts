import { describe, expect, it } from "vitest";
import { $, FakeApp, fixture, flush, loadView } from "./test/host";
import type { DeparturesResult, TripResult } from "./shared/types";

/** Board of Lyon Part Dieu: the first train 3 min late on track 4, the second cancelled, the third on time. */
function sncfBoard(): DeparturesResult {
  const data = fixture<DeparturesResult>("departures");
  Object.assign(data.stopTimes[0], {
    realTime: true,
    time: "2026-10-12T21:19:00Z",
    track: "4",
    trainNumber: "6633",
    stops: [
      { name: "Lyon Perrache", time: "2026-10-12T21:28:00Z" },
    ],
  });
  Object.assign(data.stopTimes[1], {
    cancelled: true,
    stops: [
      { name: "Paris Gare de Lyon Hall 1 - 2", time: "2026-10-13T05:56:00Z" },
      { name: "Bruxelles Midi", time: "2026-10-13T07:30:00Z" },
    ],
  });
  Object.assign(data.stopTimes[2], { realTime: true });
  return data;
}

const data = () => sncfBoard();

/** The same board in a station outside France: the generic board. */
function board(): DeparturesResult {
  const data = sncfBoard();
  data.stop.tz = "Europe/Brussels";
  return data;
}

const text = (el: Element) => el.textContent!.replace(/\s+/g, " ").trim();
const rows = () => [...document.querySelectorAll("tr[data-index]")].map(text);
const trains = () => [...document.querySelectorAll("ol.sncf-board li.train")];

describe("departures view", () => {
  /** Board of Paris Gare de Lyon: its long-distance trains, RER A and buses. */
  function station(): DeparturesResult {
    const data = sncfBoard();
    data.stopTimes.push({ ...data.stopTimes[2], mode: "REGIONAL_RAIL", line: "A", agency: "RER", tripId: "rer-a", trainNumber: "ZUMO83" });
    data.stationLines = [
      { mode: "HIGHSPEED_RAIL", line: "TGV INOUI", agency: "SNCF VOYAGEURS" },
      { mode: "REGIONAL_RAIL", line: "A", agency: "RER" },
      { mode: "BUS", line: "24", agency: "RATP" },
    ];
    return data;
  }

  const tabs = () => [...document.querySelectorAll<HTMLButtonElement>("button[role=tab]")];

  it("shows the departures of a station by tab, the trains first", async () => {
    const app = await loadView("departures");
    const longDistance = sncfBoard();
    longDistance.stopTimes = longDistance.stopTimes.slice(0, 2);
    app.answer(longDistance);
    await app.toolResult({ stopId: "IDFM:73626" }, station());

    expect(tabs().map((tab) => tab.getAttribute("aria-label"))).toEqual(["Trains", "RER A", "Bus"]);
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs()[1].querySelector("svg")).not.toBeNull();
    // the trains of the tab in the result, before its departures
    expect(trains()).toHaveLength(3);
    expect(app.callServerTool).toHaveBeenCalledWith({
      name: "departures",
      arguments: {
        stopId: "IDFM:73626",
        station: true,
        modes: ["HIGHSPEED_RAIL", "LONG_DISTANCE", "NIGHT_RAIL", "REGIONAL_FAST_RAIL", "REGIONAL_RAIL", "SUBURBAN"],
        lines: ["TGV INOUI"],
      },
    });
    await flush();
    expect(trains()).toHaveLength(2);
    expect(tabs()).toHaveLength(3);

    const bus = sncfBoard();
    bus.stopTimes = [{ ...bus.stopTimes[0], mode: "BUS", line: "24", agency: "RATP", trainNumber: undefined }];
    app.answer(bus);
    tabs()[2].click();
    expect(tabs()[2].getAttribute("aria-selected")).toBe("true");
    expect(app.callServerTool).toHaveBeenLastCalledWith({
      name: "departures",
      arguments: { stopId: "IDFM:73626", station: true, modes: ["BUS", "COACH"] },
    });
    await flush();
    expect(rows()).toHaveLength(1);
    expect(trains()).toHaveLength(0);

    // pages of the tab
    app.answer(bus);
    $<HTMLButtonElement>("button[data-action=next]").click();
    expect(app.callServerTool).toHaveBeenLastCalledWith({
      name: "departures",
      arguments: { stopId: "IDFM:73626", station: true, modes: ["BUS", "COACH"], pageCursor: bus.nextPageCursor },
    });
    await flush();
  });

  it("shows the answer of the last tab clicked", async () => {
    const app = await loadView("departures");
    let answerFirst: (value: unknown) => void = () => undefined;
    app.callServerTool.mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve)));
    await app.toolResult({ stopId: "IDFM:73626" }, station());
    const rerA = sncfBoard();
    rerA.stopTimes = [{ ...rerA.stopTimes[0], mode: "REGIONAL_RAIL", line: "A", agency: "RER" }];
    app.answer(rerA);
    tabs()[1].click();
    await flush();

    answerFirst({ content: [], structuredContent: sncfBoard() });
    await flush();
    expect(trains()).toHaveLength(1);
    expect(tabs()[1].getAttribute("aria-selected")).toBe("true");
  });

  it("shows the board with delays, tracks and cancellations", async () => {
    const app = await loadView("departures");
    await app.toolResult({ stop: "Lyon Part-Dieu", count: 3 }, board());

    expect($("#title").textContent).toBe("Lyon Part Dieu");
    expect($("#subtitle").textContent).toBe("Departures · Mon 12 Oct");
    expect(rows()).toEqual([
      "23:16 23:19 (+3) 6633 Lyon PerracheSNCF VOYAGEURS track 4",
      "05:50 9852 Bruxelles Midi cancelledSNCF VOYAGEURS",
      "06:04 6602 Paris Gare de Lyon Hall 1 - 2SNCF VOYAGEURS",
    ]);
    expect(document.querySelectorAll("tr[data-index] .sncf-train svg")).toHaveLength(3);
    expect($("#status").hidden).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect($("#fullscreen").hidden).toBe(false);
  });

  it("shows the board of a French station like the SNCF boards", async () => {
    const app = await loadView("departures");
    await app.toolResult({ stopId: "S1", count: 3 }, sncfBoard());

    expect($("ol.sncf-board").classList.contains("arrivals")).toBe(false);
    expect(trains().map(text)).toEqual([
      "6633 23:16 Lyon Perrache+3 min 4",
      "9852 05:50 Bruxelles Midicancelled Paris Gare de Lyon Hall 1 - 2 07:56",
      "6602 06:04 Paris Gare de Lyon Hall 1 - 2",
    ]);
    expect(trains().map((li) => li.className.trim())).toEqual(["train delayed", "train deleted", "train"]);
    expect(trains()[0].querySelector(".min")!.getAttribute("title")).toBe("expected at 23:19");
    expect(trains()[0].querySelector(".origine svg")).not.toBeNull();
    expect(trains()[2].querySelector(".platform")!.classList.contains("empty")).toBe(true);

    app.answer(fixture<TripResult>("trip"));
    (trains()[0] as HTMLElement).click();
    await flush();
    expect(app.callServerTool).toHaveBeenLastCalledWith({ name: "trip_details", arguments: { tripId: data().stopTimes[0].tripId } });
  });

  it("shows the origin and the previous stops of the arrivals of a French station", async () => {
    const app = await loadView("departures");
    const data = sncfBoard();
    data.arriveBy = true;
    data.stopTimes[1].stops = [
      { name: "Marseille Saint-Charles", time: "2026-10-13T02:00:00Z" },
      { name: "Avignon TGV", time: "2026-10-13T02:30:00Z" },
    ];
    await app.toolResult({ stopId: "S1", arriveBy: true }, data);

    expect($("ol.sncf-board").classList.contains("arrivals")).toBe(true);
    expect(text(trains()[1])).toBe("9852 05:50 Marseille Saint-Charlescancelled Avignon TGV 04:30");
  });

  it("shows the brand, line pictogram or badge of the other trains and lines of a French station", async () => {
    const app = await loadView("departures");
    const data = sncfBoard();
    Object.assign(data.stopTimes[0], { mode: "REGIONAL_RAIL", line: "TER", trainNumber: "891001" });
    Object.assign(data.stopTimes[1], { mode: "REGIONAL_RAIL", line: "D", agency: "RER", trainNumber: "ZEUS" });
    Object.assign(data.stopTimes[2], { mode: "BUS", line: "C3", agency: "TCL", routeColor: "#ff0000" });
    await app.toolResult({ stopId: "S1" }, data);

    expect(trains()[0].querySelector(".origine")!.textContent).toBe("TER");
    expect(trains()[0].querySelector(".numero")!.textContent).toBe("891001");
    expect(trains()[1].querySelector(".origine .sncf-line svg")).not.toBeNull();
    expect(trains()[1].querySelector(".numero")!.textContent).toBe("ZEUS");
    expect(trains()).toHaveLength(2);
    expect(document.querySelector("tr[data-index='2'] .badge")!.textContent).toBe("C3");
  });

  it("lists the buses and metros of a French station with few trains below its SNCF board", async () => {
    const app = await loadView("departures");
    const data = sncfBoard();
    data.stopTimes[0].mode = "BUS";
    data.stopTimes[1].mode = "SUBWAY";
    await app.toolResult({ stopId: "S1" }, data);

    expect(trains().map((li) => (li as HTMLElement).dataset.index)).toEqual(["2"]);
    expect($("h3").textContent).toBe("Other lines");
    expect([...document.querySelectorAll<HTMLElement>("tr[data-index]")].map((tr) => tr.dataset.index)).toEqual(["0", "1"]);

    app.answer(fixture<TripResult>("trip"));
    (document.querySelector("tr[data-index='1']") as HTMLElement).click();
    await flush();
    expect(app.callServerTool).toHaveBeenLastCalledWith({ name: "trip_details", arguments: { tripId: data.stopTimes[1].tripId } });
  });

  it("shows only the trains of the later departures of a French station with other lines", async () => {
    const app = await loadView("departures");
    const data = sncfBoard();
    data.stopTimes[0].mode = "BUS";
    await app.toolResult({ stopId: "S1", count: 3 }, data);

    app.answer(sncfBoard());
    $("button[data-action=next]").click();
    await flush();
    const modes = ["HIGHSPEED_RAIL", "LONG_DISTANCE", "NIGHT_RAIL", "REGIONAL_FAST_RAIL", "REGIONAL_RAIL", "SUBURBAN"];
    expect(app.callServerTool).toHaveBeenLastCalledWith({
      name: "departures",
      arguments: { stopId: "S1", count: 3, modes, pageCursor: "LATER|1791864300" },
    });
    expect(document.querySelector("h3")).toBeNull();

    app.answer(sncfBoard());
    $("button[data-action=previous]").click();
    await flush();
    expect(app.callServerTool).toHaveBeenLastCalledWith({ name: "departures", arguments: expect.objectContaining({ modes }) });
  });

  it("keeps the generic board at a French stop without trains", async () => {
    const app = await loadView("departures");
    const data = sncfBoard();
    data.stopTimes.forEach((st) => (st.mode = "BUS"));
    await app.toolResult({ stopId: "S1" }, data);

    expect(document.querySelector("ol.sncf-board")).toBeNull();
    expect(rows()).toHaveLength(3);
  });

  it("pages and switches to the arrivals, with the arguments of the call", async () => {
    const app = await loadView("departures");
    await app.toolResult({ stopId: "S1", count: 3 }, board());

    app.answer({ ...board(), previousPageCursor: undefined, nextPageCursor: undefined });
    $("button[data-action=next]").click();
    await flush();
    expect(app.callServerTool).toHaveBeenLastCalledWith({ name: "departures", arguments: { stopId: "S1", count: 3, pageCursor: "LATER|1791864300" } });
    expect($<HTMLButtonElement>("button[data-action=next]").disabled).toBe(true);

    app.answer({ ...board(), arriveBy: true, stopTimes: [] });
    $("button[data-action=arrivals]").click();
    await flush();
    expect(app.callServerTool).toHaveBeenLastCalledWith({ name: "departures", arguments: { stopId: "S1", count: 3, arriveBy: true } });
    expect($("#subtitle").textContent).toBe("Arrivals");
    expect($("#content").textContent).toContain("No departure in this period.");

    app.answer(new Error("MOTIS error: unknown stop"));
    $("button[data-action=departures]").click();
    await flush();
    expect($("#status").textContent).toBe("MOTIS error: unknown stop");
    expect($("#status").dataset.kind).toBe("error");
  });

  it("opens a trip from the board, and goes back", async () => {
    const app = await loadView("departures");
    await app.toolResult({ stopId: "S1" }, board());
    const trip = fixture<TripResult>("trip");
    trip.itinerary.legs[0].intermediateStops![0].departure = "2026-10-12T19:30:00Z";
    app.answer(trip);

    (document.querySelector("tr[data-index='0']") as HTMLElement).click();
    await flush();

    expect(app.callServerTool).toHaveBeenLastCalledWith({
      name: "trip_details",
      arguments: { tripId: "20261012_21:00_fr-horaires-sncf_FR:ServiceJourney::SN6633FERRE_12999392" },
    });
    expect($("#title").textContent).toBe("TGV INOUI 6633 → Lyon Perrache");
    expect($("#subtitle").textContent).toBe("Mon 12 Oct · 2 h 24 · SNCF VOYAGEURS");
    const stops = [...document.querySelectorAll("li.stop")].map((li) => li.textContent!.replace(/\s+/g, " ").trim());
    expect(stops).toHaveLength(5);
    expect(stops[0]).toMatch(/^\d\d:\d\d Paris Gare de Lyon Hall 1 - 2$/);
    expect(stops.at(-1)).toMatch(/Lyon Perrache$/);

    $("#back").click();
    expect($("#title").textContent).toBe("Lyon Part Dieu");
  });

  it("shows a trip result without a board to go back to", async () => {
    const app = await loadView("departures");
    await app.toolResult({ tripId: "t" }, fixture("trip"));

    expect($("#title").textContent).toBe("TGV INOUI 6633 → Lyon Perrache");
    expect($("#back").hidden).toBe(true);
  });

  it("reports the tool errors and cancellations of the host", async () => {
    const app = await loadView("departures");

    app.ontoolresult?.({ content: [{ type: "text", text: "MOTIS error: unknown stop" }], isError: true });
    expect($("#status").textContent).toBe("MOTIS error: unknown stop");
    app.ontoolresult?.({ content: [{ type: "text", text: "plain text" }] });
    expect($("#status").textContent).toBe("plain text");
    app.ontoolcancelled?.();
    expect($("#status").textContent).toBe("Cancelled");
  });

  it("toggles fullscreen, and leaves it with Escape", async () => {
    const app = await loadView("departures");

    $("#fullscreen").click();
    await flush();
    expect(app.requestDisplayMode).toHaveBeenLastCalledWith({ mode: "fullscreen" });
    expect(document.documentElement.dataset.displayMode).toBe("fullscreen");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await flush();
    expect(document.documentElement.dataset.displayMode).toBe("inline");

    app.requestDisplayMode.mockRejectedValueOnce(new Error("not supported"));
    $("#fullscreen").click();
    await flush();
    expect(document.documentElement.dataset.displayMode).toBe("inline");
  });

  it("follows the host context changes", async () => {
    const app = await loadView("departures");

    app.onhostcontextchanged?.({ theme: "light", availableDisplayModes: ["inline"], displayMode: "inline" });

    expect(document.documentElement.dataset.theme).toBe("light");
    expect($("#fullscreen").hidden).toBe(true);
    expect(document.body.style.padding).toBe("1px 2px 3px 4px");
  });

  it("reports a failed connection to the host", async () => {
    FakeApp.failNextConnection = true;
    await loadView("departures");
    await flush();

    expect($("#status").textContent).toBe("Connection to the host failed: Error: no host");
  });
});

describe("departures view in French", () => {
  it("uses the locale of the host for the static texts, the board and the dates", async () => {
    FakeApp.nextLocale = "fr-FR";
    const app = await loadView("departures");
    await Promise.resolve();
    expect(document.documentElement.lang).toBe("fr");
    expect($("#title").textContent).toBe("Départs");
    expect($("#fullscreen").title).toBe("Plein écran");
    expect($("#status").textContent).toBe("Chargement…");

    await app.toolResult({ stopId: "S1", count: 3 }, board());
    expect($("#subtitle").textContent).toMatch(/^Départs · lun\. 12 oct\.$/);
    expect(rows()[0]).toContain("voie 4");
    expect(rows()[1]).toContain("supprimé");
    expect($("button[data-action=arrivals]").textContent).toBe("Arrivées");
    expect($("button[data-action=next]").textContent).toBe("Plus tard →");
  });
});
