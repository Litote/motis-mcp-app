import { describe, expect, it, vi } from "vitest";
import { $, FakeApp, fixture, flush, loadView } from "./test/host";
import type { DeparturesResult, StopTimeDto, TripResult } from "./shared/types";

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

/** The same board in a station of a country without a board of its own (Austria): the generic board. */
function board(): DeparturesResult {
  const data = sncfBoard();
  data.stop.tz = "Europe/Vienna";
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
      "23:19 +3 23:16 6633 Lyon PerracheSNCF VOYAGEURS track 4",
      "05:50 9852 Bruxelles Midi cancelledSNCF VOYAGEURS",
      "06:04 6602 Paris Gare de Lyon Hall 1 - 2SNCF VOYAGEURS",
    ]);
    expect(document.querySelectorAll("tr[data-index] .sncf-train svg")).toHaveLength(3);
    expect($("#status").hidden).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect($("#fullscreen").hidden).toBe(false);
  });

  it("dims the departures gone, by their expected time, else their scheduled one", async () => {
    // between the expected time of the first train (21:19, 3 min late) and the next departure
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T21:17:00Z"));
    try {
      const app = await loadView("departures");
      await app.toolResult({}, board());
      expect([...document.querySelectorAll("tr[data-index]")].map((row) => row.classList.contains("past"))).toEqual([false, false, false]);

      vi.setSystemTime(new Date("2026-10-12T21:20:00Z"));
      await app.toolResult({}, sncfBoard());
      expect(trains().map((train) => train.classList.contains("past"))).toEqual([true, false, false]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("dims a departure once the minute of its expected time is over", async () => {
    // the first train is expected at 21:19
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T21:19:59Z"));
    try {
      const app = await loadView("departures");
      await app.toolResult({}, sncfBoard());
      expect(trains()[0].classList.contains("past")).toBe(false);

      vi.setSystemTime(new Date("2026-10-12T21:20:00Z"));
      await app.toolResult({}, sncfBoard());
      expect(trains()[0].classList.contains("past")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks the scheduled times of a board mixing real and scheduled times", async () => {
    const app = await loadView("departures");
    const mixed = board();
    mixed.stopTimes[2].realTime = false;
    await app.toolResult({ stop: "Lyon Part-Dieu" }, mixed);

    // the cancelled departure is not marked
    expect(rows()[1]).not.toContain("scheduled");
    expect(rows()[2]).toBe("06:04 scheduled 6602 Paris Gare de Lyon Hall 1 - 2SNCF VOYAGEURS");
    expect(document.querySelector(".theoretical-note")).toBeNull();

    await app.toolResult({ stopId: "S1" }, { ...sncfBoard(), stopTimes: mixed.stopTimes });
    expect(trains().map((train) => train.querySelector(".theoretical") !== null)).toEqual([false, false, true]);
  });

  it("says once that a board without real time has scheduled times", async () => {
    const app = await loadView("departures");
    const scheduled = sncfBoard();
    scheduled.stopTimes.forEach((st) => Object.assign(st, { realTime: false, time: st.scheduledTime }));
    await app.toolResult({ stopId: "S1" }, scheduled);

    expect($(".theoretical-note").textContent).toBe("Scheduled times: no real-time data for these departures.");
    expect(document.querySelectorAll(".theoretical:not(.theoretical-note)")).toHaveLength(0);
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
    // the fixture is in the past: its departures are gone
    expect(trains().map((li) => [...li.classList].join(" "))).toEqual(["train delayed past", "train deleted past", "train past"]);
    expect(trains()[0].querySelector(".min")!.getAttribute("title")).toBe("expected at 23:19");
    expect(trains()[0].querySelector(".origine svg")).not.toBeNull();
    expect(trains()[2].querySelector(".platform")!.classList.contains("empty")).toBe(true);

    app.answer(fixture<TripResult>("trip"));
    (trains()[0] as HTMLElement).click();
    await flush();
    expect(app.callServerTool).toHaveBeenLastCalledWith({ name: "trip_details", arguments: { tripId: data().stopTimes[0].tripId } });
  });

  it("brings the top of the view back into view when a trip is opened from the bottom of the board", async () => {
    const app = await loadView("departures");
    await app.toolResult({ stopId: "S1" }, data());
    const scrollIntoView = vi.fn();
    $("header").scrollIntoView = scrollIntoView;

    app.answer(fixture<TripResult>("trip"));
    (trains()[2] as HTMLElement).click();
    await flush();

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("orders the SNCF board by scheduled time: a late train keeps its place", async () => {
    const app = await loadView("departures");
    const data = sncfBoard();
    // MOTIS gives them by expected time: the train scheduled at 23:16, expected at 23:30, after the one of 23:20
    const late = { ...data.stopTimes[0], time: "2026-10-12T21:30:00Z" };
    const onTime = { ...data.stopTimes[2], scheduledTime: "2026-10-12T21:20:00Z", time: "2026-10-12T21:20:00Z" };
    data.stopTimes = [onTime, late];
    await app.toolResult({ stopId: "S1", count: 2 }, data);

    expect(trains().map((li) => text(li).slice(0, 10))).toEqual(["6633 23:16", "6602 23:20"]);
    app.answer(fixture<TripResult>("trip"));
    (trains()[0] as HTMLElement).click();
    await flush();
    expect(app.callServerTool).toHaveBeenLastCalledWith({ name: "trip_details", arguments: { tripId: late.tripId } });
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

  it("shows the origin of the arrivals of a station outside France, its headsign when unknown", async () => {
    const app = await loadView("departures");
    const data = board();
    data.arriveBy = true;
    data.stopTimes[0].headsign = "Bruxelles-Midi";
    data.stopTimes[0].stops = [{ name: "Ostende", time: "2026-10-13T02:00:00Z" }];
    data.stopTimes[1].stops = undefined;
    await app.toolResult({ stopId: "S1", arriveBy: true }, data);

    expect(rows()[0]).toContain("Ostende");
    expect(rows()[0]).not.toContain("Bruxelles-Midi");
    expect(rows()[1]).toContain(data.stopTimes[1].headsign);
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

  it("opens a train with the trip of the other feed that gives its real time", async () => {
    const app = await loadView("departures");
    const data = sncfBoard();
    data.stopTimes[2].realTimeTripId = "fr-trenitalia-1";
    await app.toolResult({ stopId: "S1" }, data);

    app.answer(fixture<TripResult>("trip"));
    (trains()[2] as HTMLElement).click();
    await flush();
    expect(app.callServerTool).toHaveBeenLastCalledWith({
      name: "trip_details",
      arguments: { tripId: data.stopTimes[2].tripId, realTimeTripId: "fr-trenitalia-1" },
    });
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

  it("shows the station of the board in bold in the stops of the trip, whatever its id in the feed of the trip", async () => {
    const app = await loadView("departures");
    // the board of Lyon Part Dieu from the Renfe feed, the trip from the SNCF one
    await app.toolResult({ stopId: "S1" }, board());
    app.answer(fixture<TripResult>("trip"));
    (document.querySelector("tr[data-index='0']") as HTMLElement).click();
    await flush();

    expect([...document.querySelectorAll("li.stop.board-stop .name")].map(text)).toEqual(["Lyon Part Dieu"]);
  });

  it("shows the station of the board in bold at the time of the departure, for a trip through it twice", async () => {
    const app = await loadView("departures");
    await app.toolResult({ stopId: "S1" }, board());
    const trip = fixture<TripResult>("trip");
    const leg = trip.itinerary.legs[0];
    // the first stop renamed Lyon Part Dieu too, left before the departure of the board (21:16)
    leg.from.name = "Lyon Part Dieu";
    app.answer(trip);
    (document.querySelector("tr[data-index='0']") as HTMLElement).click();
    await flush();

    const stops = [...document.querySelectorAll("li.stop")];
    expect(stops.map((li) => li.classList.contains("board-stop"))).toEqual([false, false, false, true, false]);
  });

  it("shows no station in bold for a trip asked without a board", async () => {
    const app = await loadView("departures");
    await app.toolResult({ tripId: "t" }, fixture("trip"));

    expect(document.querySelector("li.stop.board-stop")).toBeNull();
  });

  describe("position of the train", () => {
    async function tripAt(now: string): Promise<Element[]> {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(now));
      const app = await loadView("departures");
      await app.toolResult({ tripId: "t" }, fixture("trip"));
      return [...document.querySelectorAll("ol.timeline > li")];
    }
    const shape = (items: Element[]) =>
      items.map((li) => (li.classList.contains("between") ? "train" : li.querySelector(".vehicle") ? "stop+train" : "stop"));

    it("is between two stops while running", async () => {
      try {
        // left Le Creusot at 20:23, at Mâcon at 20:41
        expect(shape(await tripAt("2026-10-12T20:30:00Z"))).toEqual(["stop", "stop", "train", "stop", "stop", "stop"]);
        expect($("li.between .vehicle").getAttribute("aria-label")).toBe("Current position of the train");
      } finally {
        vi.useRealTimers();
      }
    });

    it("is at a stop between its arrival and its departure", async () => {
      try {
        // at Lyon Part Dieu from 21:10 to 21:16
        expect(shape(await tripAt("2026-10-12T21:12:00Z"))).toEqual(["stop", "stop", "stop", "stop+train", "stop"]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("moves every minute, the rest of the timeline left as it is", async () => {
      vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
      try {
        vi.setSystemTime(new Date("2026-10-12T20:30:00Z"));
        const app = await loadView("departures");
        await app.toolResult({ tripId: "t" }, fixture("trip"));
        const stops = [...document.querySelectorAll("li.stop")];
        const items = () => [...document.querySelectorAll("ol.timeline > li")];
        expect(shape(items())).toEqual(["stop", "stop", "train", "stop", "stop", "stop"]);

        // at Mâcon from 20:41 to 20:44
        vi.advanceTimersByTime(12 * 60_000);
        expect(shape(items())).toEqual(["stop", "stop", "stop+train", "stop", "stop"]);
        expect([...document.querySelectorAll("li.stop")]).toEqual(stops);
        expect(document.querySelectorAll(".vehicle")).toHaveLength(1);
        expect(getComputedStyle(stops[2].querySelector(".dot")!).display).toBe("none");
      } finally {
        vi.useRealTimers();
      }
    });

    it("is not shown before the departure or after the arrival", async () => {
      try {
        await tripAt("2026-10-12T18:00:00Z");
        expect(document.querySelector(".vehicle")).toBeNull();
        await tripAt("2026-10-12T21:30:00Z");
        expect(document.querySelector(".vehicle")).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("strikes out the scheduled time of each stop of a trip late or early, before the actual one", async () => {
    const app = await loadView("departures");
    const trip = fixture<TripResult>("trip");
    const leg = trip.itinerary.legs[0];
    const shift = (at: string | null | undefined, minutes: number) => (at ? new Date(Date.parse(at) + minutes * 60_000).toISOString() : at);
    // 3 min early from the start, then on time again from the third stop
    [leg.from, ...leg.intermediateStops!, leg.to].forEach((stop, i) => {
      const minutes = i < 2 ? -3 : 0;
      Object.assign(stop, { departure: shift(stop.scheduledDeparture, minutes), arrival: shift(stop.scheduledArrival, minutes) });
    });
    await app.toolResult({ tripId: "t" }, trip);

    const times = [...document.querySelectorAll("li.stop .time")];
    expect(times.map((time) => time.querySelector("s.scheduled-time") !== null)).toEqual([true, true, false, false, false]);
    expect(times[0].textContent).toMatch(/^\d\d:\d\d \d\d:\d\d$/);
    expect(document.querySelector("li.stop .delay")).toBeNull();
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

  describe("fullscreen", () => {
    const columns = () => [...document.querySelectorAll(".board-column")];
    const fullscreen = async (app: FakeApp, mode: "fullscreen" | "inline") => {
      app.onhostcontextchanged?.({ displayMode: mode });
      await flush();
    };

    it("shows the departures and the arrivals side by side, paging both", async () => {
      const app = await loadView("departures");
      await app.toolResult({ stopId: "S1" }, board());
      const arrivals = { ...board(), arriveBy: true, previousPageCursor: "EARLIER|arrivals", nextPageCursor: "LATER|arrivals" };
      app.answer(arrivals);

      await fullscreen(app, "fullscreen");

      expect(app.callServerTool).toHaveBeenLastCalledWith({ name: "departures", arguments: { stopId: "S1", arriveBy: true } });
      expect(columns().map((c) => text(c.querySelector(".board-head")!))).toEqual(["Departures", "Arrivals"]);
      expect($("#subtitle").textContent).toMatch(/^Departures · Arrivals · /);
      expect(document.querySelector("button[data-action=arrivals]")).toBeNull();
      expect($(".clock").textContent).toMatch(/^\d\d:\d\d$/);

      // the other board is asked first
      app.answer(arrivals, board());
      $("button[data-action=next]").click();
      await flush();
      expect(app.callServerTool).toHaveBeenCalledWith({ name: "departures", arguments: { stopId: "S1", arriveBy: true, pageCursor: "LATER|arrivals" } });
      expect(app.callServerTool).toHaveBeenLastCalledWith({ name: "departures", arguments: { stopId: "S1", pageCursor: "LATER|1791864300" } });

      await fullscreen(app, "inline");
      expect(columns()).toHaveLength(0);
      expect($("#subtitle").textContent).toMatch(/^Departures · /);
      expect(document.querySelector("button[data-action=arrivals]")).not.toBeNull();
    });

    it("opens a trip beside the boards, and in place of the board once back inline", async () => {
      const app = await loadView("departures");
      await app.toolResult({ stopId: "S1" }, board());
      app.answer({ ...board(), arriveBy: true });
      await fullscreen(app, "fullscreen");
      const trip = { ...fixture<TripResult>("trip"), tripId: board().stopTimes[0].tripId };
      app.answer(trip);

      const boards = $(".boards");
      (columns()[1].querySelector("tr[data-index='0']") as HTMLElement).click();
      // loading in the panel, without the status bar above the boards
      expect($(".trip-panel").getAttribute("aria-busy")).toBe("true");
      expect($("#status").hidden).toBe(true);
      await flush();

      expect($(".trip-panel strong").textContent).toBe("TGV INOUI 6633 → Lyon Perrache");
      // the boards are left as they are: only the panel and the departure of the trip change
      expect(boards.isConnected).toBe(true);
      expect(boards.style.gridTemplateColumns).toBe("minmax(0px, 1fr) minmax(0px, 1fr) minmax(260px, 340px)");
      expect($("#title").textContent).toBe("Lyon Part Dieu");
      expect(document.querySelectorAll("tr.open")).toHaveLength(2);

      $("button[data-action=close-trip]").click();
      expect(document.querySelector(".trip-panel")).toBeNull();
      expect(document.querySelectorAll("tr.open")).toHaveLength(0);
      expect(boards.isConnected).toBe(true);

      app.answer(new Error("MOTIS error: unknown trip"));
      (columns()[0].querySelector("tr[data-index='0']") as HTMLElement).click();
      await flush();
      expect(document.querySelector(".trip-panel")).toBeNull();
      expect($("#status").textContent).toBe("MOTIS error: unknown trip");

      app.answer(trip);
      (columns()[0].querySelector("tr[data-index='0']") as HTMLElement).click();
      await flush();
      await fullscreen(app, "inline");
      expect($("#title").textContent).toBe("TGV INOUI 6633 → Lyon Perrache");
      expect($("#back").hidden).toBe(false);
    });

    it("draws the other board again on its own when it comes after the board", async () => {
      const app = await loadView("departures");
      await app.toolResult({ stopId: "S1" }, board());
      app.answer({ ...board(), arriveBy: true });
      await fullscreen(app, "fullscreen");
      let answerOpposite!: (result: unknown) => void;
      app.callServerTool.mockImplementationOnce(() => new Promise((resolve) => (answerOpposite = resolve)));
      app.answer(board());

      $("button[data-action=next]").click();
      await flush();
      const departures = columns()[0];
      answerOpposite({ content: [], structuredContent: { ...board(), arriveBy: true, stopTimes: [] } });
      await flush();

      expect(departures.isConnected).toBe(true);
      expect(columns()[1].textContent).toContain("No departure in this period.");
      app.answer(fixture("trip"));
      (departures.querySelector("tr[data-index='0']") as HTMLElement).click();
      await flush();
      expect(document.querySelector(".trip-panel")).not.toBeNull();
      await fullscreen(app, "inline");
    });

    it("shows a trip opened inline, and the boards side by side once back to the board", async () => {
      const app = await loadView("departures");
      await app.toolResult({ stopId: "S1" }, board());
      app.answer(fixture("trip"));
      (document.querySelector("tr[data-index='0']") as HTMLElement).click();
      await flush();

      await fullscreen(app, "fullscreen");
      expect($("#title").textContent).toBe("TGV INOUI 6633 → Lyon Perrache");

      app.answer({ ...board(), arriveBy: true });
      $("#back").click();
      await flush();
      expect(columns()).toHaveLength(2);
      await fullscreen(app, "inline");
    });
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
    expect($("button[data-action=next]").textContent).toBe("Plus tard");
  });

  it("marks the departures with service alerts, and lists those of the board under a banner", async () => {
    const app = await loadView("departures");
    const result = board();
    result.alerts = [{ header: "Grève" }, { header: "Ligne interrompue", effect: "NO_SERVICE" }, { header: "Not on the board" }];
    result.stopTimes[0].alerts = [0];
    result.stopTimes[2].alerts = [0, 1];
    await app.toolResult({}, result);

    const marks = [...document.querySelectorAll("tr[data-index]")].map((row) => row.querySelector(".alert-mark"));
    // the alert of several departures is marked on their rows and under the banner
    expect(marks.map((m) => m?.getAttribute("title") ?? null)).toEqual(["Grève", null, "Grève"]);
    expect(text($(".alert-banner > summary"))).toBe("Service alerts (1)");
    expect([...document.querySelectorAll(".alert-banner .alert")].map(text)).toEqual(["6633, 6602 — Grève"]);
    // the alert of a single departure is under its row
    const lines = [...document.querySelectorAll("tr[data-index]")].map((row) => row.querySelector(".alert-line"));
    expect(lines.map((l) => (l ? text(l) : null))).toEqual([null, null, "Ligne interrompue"]);
    expect(lines[2]?.classList.contains("severe")).toBe(true);
  });

  it("marks the trains of a French station with service alerts", async () => {
    const app = await loadView("departures");
    const result = sncfBoard();
    result.alerts = [{ header: "Train court" }];
    result.stopTimes[1].alerts = [0];
    await app.toolResult({}, result);

    // the alert of a single train is under its row, not under the banner
    expect(trains().map((train) => train.querySelector(".alert-line")?.textContent ?? null)).toEqual([null, "Train court", null]);
    expect(document.querySelector(".alert-mark, .alert-banner")).toBeNull();
  });

  it("names the trains of the alerts of a few trains under the banner: the SNCF gives them the same header", async () => {
    const app = await loadView("departures");
    const result = sncfBoard();
    // a TGV coupled to another one at the station: the alert of both is on two rows
    result.stopTimes.push({ ...result.stopTimes[0], tripId: "coupled", line: "TGV INOUI 12526", trainNumber: undefined, alerts: [1] });
    result.alerts = [
      { header: "Votre train est retardé.", description: "Cause : maintenance à Perpignan." },
      { header: "Votre train est retardé.", description: "Cause : maintenance à Roissy." },
    ];
    result.stopTimes[0].alerts = [0];
    result.stopTimes[1].alerts = [1];
    result.stopTimes[2].alerts = [0];
    await app.toolResult({}, result);

    expect([...document.querySelectorAll(".alert-banner .alert summary")].map(text)).toEqual([
      "6633, 6602 — Votre train est retardé.",
      "9852, 12526 — Votre train est retardé.",
    ]);
  });

  it("lists the service alerts of a trip above its stops", async () => {
    const app = await loadView("departures");
    const trip = fixture<TripResult>("trip");
    trip.alerts = [{ header: "Travaux", description: "Arrêt reporté." }];
    trip.itinerary.legs.find((leg) => leg.tripId)!.alerts = [0];
    await app.toolResult({}, trip);

    expect([...document.querySelectorAll(".trip .alert")].map(text)).toEqual(["TravauxArrêt reporté."]);
    // A lone alert is unfolded already: nothing hints to click it.
    expect(document.querySelector<HTMLDetailsElement>(".trip .alert details")?.open).toBe(true);
  });
});


describe("departures view at a German station", () => {
  /** Board of Berlin Hbf: an ICE 3 min late on track 6, a cancelled RE 20, an S-Bahn, and a bus. */
  function dbBoard(): DeparturesResult {
    const data = fixture<DeparturesResult>("departures");
    data.stop = { ...data.stop, name: "Berlin Hbf", stopId: "de:11000:900003200", tz: "Europe/Berlin" };
    const [first, second, third] = data.stopTimes;
    data.stopTimes = [
      {
        ...first,
        line: "ICE 546",
        agency: "DB Fernverkehr AG",
        // with its category, as in the feed of the DB
        trainNumber: "ICE 546",
        realTime: true,
        time: "2026-10-12T21:19:00Z",
        track: "6",
        headsign: "Köln Hbf",
        stops: [
          { name: "Berlin-Spandau", time: "2026-10-12T21:30:00Z" },
          { name: "Köln Hbf", time: "2026-10-13T01:46:00Z" },
        ],
      },
      { ...second, mode: "REGIONAL_RAIL", line: "RE20", agency: "DB Regio AG Nordost", trainNumber: "018516", cancelled: true, track: "1", headsign: "Lübbenau, Bahnhof" },
      { ...third, mode: "SUBURBAN", line: "S3", agency: "S-Bahn Berlin GmbH", trainNumber: "3102", routeColor: "0066ad", track: "16", headsign: "S Spandau Bhf (Berlin)" },
      { ...third, mode: "BUS", line: "M41", agency: "Berliner Verkehrsbetriebe", tripId: "bus-m41", headsign: "Sonnenallee/Baumschulenstr.", track: "Pos. 2" },
    ];
    return data;
  }

  const trains = () => [...document.querySelectorAll<HTMLElement>("ol.db-board li.train")];

  it("shows the board of a German station like the timetables posted at its stations", async () => {
    const app = await loadView("departures");
    await app.toolResult({ stopId: "S1" }, dbBoard());

    expect(document.querySelector("ol.sncf-board")).toBeNull();
    expect($("ol.db-board").classList.contains("arrivals")).toBe(false);
    expect(trains().map(text)).toEqual([
      "23:16 ICE 546 Köln Hbf 03:46+3 min Berlin-Spandau 23:30 6",
      "05:50 RE 2018516 Lübbenau, Bahnhofcancelled 1",
      "06:04 S3 S Spandau Bhf (Berlin)scheduled 16",
    ]);
    // a regional line apart from its train number, without its leading zeros
    expect(trains()[1].querySelector(".nummer")!.textContent).toBe("18516");
    // the long-distance trains in red
    expect(trains().map((li) => li.classList.contains("fern"))).toEqual([true, false, false]);
    expect(trains()[1].classList.contains("deleted")).toBe(true);
    expect(trains()[0].querySelector(".verspaetung")!.getAttribute("title")).toBe("expected at 23:19");
    // the bus below the board, on the generic one
    expect($("h3").textContent).toBe("Other lines");
    expect(document.querySelector("tr[data-index='3']")).not.toBeNull();

    app.answer(fixture<TripResult>("trip"));
    trains()[2].click();
    await flush();
    expect(app.callServerTool).toHaveBeenLastCalledWith({ name: "trip_details", arguments: { tripId: dbBoard().stopTimes[2].tripId } });
  });

  it("shows the arrivals of a German station on a white timetable, with their origin", async () => {
    const app = await loadView("departures");
    const data = dbBoard();
    data.arriveBy = true;
    data.stopTimes[0].stops = [
      { name: "Köln Hbf", time: "2026-10-12T17:13:00Z" },
      { name: "Hannover Hbf", time: "2026-10-12T19:31:00Z" },
    ];
    await app.toolResult({ stopId: "S1", arriveBy: true }, data);

    expect($("ol.db-board").classList.contains("arrivals")).toBe(true);
    expect(text(trains()[0])).toBe("23:16 ICE 546 Köln Hbf 19:13+3 min Hannover Hbf 21:31 6");
  });

  it("shows only the trains of the later departures of a German station with other lines", async () => {
    const app = await loadView("departures");
    await app.toolResult({ stopId: "S1" }, dbBoard());

    app.answer(dbBoard());
    $("button[data-action=next]").click();
    await flush();
    expect(app.callServerTool).toHaveBeenLastCalledWith({ name: "departures", arguments: expect.objectContaining({ modes: expect.arrayContaining(["SUBURBAN"]) }) });
  });

  it("keeps the generic board at a German stop without trains", async () => {
    const app = await loadView("departures");
    const data = dbBoard();
    data.stopTimes.forEach((st) => (st.mode = "BUS"));
    await app.toolResult({ stopId: "S1" }, data);

    expect(document.querySelector("ol.db-board")).toBeNull();
    expect(document.querySelectorAll("tr[data-index]")).toHaveLength(4);
  });
});

describe("departures view at the stations of the other countries with a board of their own", () => {
  /** Board of a station in [tz]: a long-distance train 5 min late, a cancelled one, a commuter line, and a bus. */
  function countryBoard(tz: string, name: string, trains: Partial<StopTimeDto>[]): DeparturesResult {
    const data = fixture<DeparturesResult>("departures");
    data.stop = { ...data.stop, name, tz };
    const [first, second, third] = data.stopTimes;
    data.stopTimes = [
      { ...first, ...trains[0], realTime: true, time: "2026-10-12T21:21:00Z", stops: [{ name: "Stop A", time: "2026-10-12T21:40:00Z" }, { name: trains[0].headsign!, time: "2026-10-12T23:00:00Z" }] },
      { ...second, ...trains[1], cancelled: true },
      { ...third, ...trains[2], realTime: true },
      { ...third, mode: "BUS", line: "42", agency: "Bus", tripId: "bus-42", headsign: "Somewhere" },
    ];
    return data;
  }

  const rowsOf = (board: string) => [...document.querySelectorAll<HTMLElement>(`ol.${board} li.train`)].map(text);

  it("shows the board of an Italian station like the monitors of RFI", async () => {
    const app = await loadView("departures");
    await app.toolResult(
      { stopId: "S1" },
      countryBoard("Europe/Rome", "Roma Termini", [
        { mode: "HIGHSPEED_RAIL", line: "FR 9540", trainNumber: "9540", agency: "TRENITALIA", routeColor: "#c8102e", headsign: "MILANO CENTRALE", track: "8" },
        { mode: "REGIONAL_RAIL", line: "RE2", trainNumber: "RE_2 - 2229", agency: "Trenord", routeColor: "#e40314", headsign: "Bergamo", track: "20 BIS" },
        { mode: "SUBURBAN", line: "S5", agency: "Trenord", headsign: "Treviglio" },
      ]),
    );

    expect(rowsOf("rfi-board")).toEqual([
      "FR9540 MILANO CENTRALE Stop A 23:40 23:16 5' 8",
      "RE2229 Bergamo 05:50 cancelled 20 BIS",
      "S5 Treviglio 06:04",
    ]);
    expect($("ol.rfi-board .categoria").getAttribute("style")).toContain("#c8102e");
    expect(document.querySelector("tr[data-index='3']")).not.toBeNull();
  });

  it("shows the board of a Spanish station like the screens of Adif", async () => {
    const app = await loadView("departures");
    await app.toolResult(
      { stopId: "S1" },
      countryBoard("Europe/Madrid", "Madrid Puerta de Atocha", [
        { mode: "HIGHSPEED_RAIL", line: "AVE 03143", trainNumber: "03143", agency: "RENFE OPERADORA", headsign: "Barcelona-Sants" },
        { mode: "HIGHSPEED_RAIL", line: "OUIGO 06231", trainNumber: "06231", agency: "OUIGO ESPAÑA", headsign: "Valencia" },
        { mode: "REGIONAL_RAIL", line: "C4a", agency: "Renfe Cercanias", routeColor: "#2c2a86", headsign: "Parla" },
      ]),
    );

    expect(rowsOf("adif-board")).toEqual([
      "23:16 Barcelona-Sants+5 min Stop A AVE03143",
      "05:50 Valenciacancelled OUIGO06231",
      "06:04 Parla C4a",
    ]);
    expect([...document.querySelectorAll("ol.adif-board .producto")].map((p) => p.className)).toEqual(["producto renfe", "producto ouigo"]);
  });

  it("shows the board of a Belgian station like the screens of the SNCB", async () => {
    const app = await loadView("departures");
    await app.toolResult(
      { stopId: "S1" },
      countryBoard("Europe/Brussels", "Bruxelles-Midi", [
        { mode: "REGIONAL_RAIL", line: "IC 2812", trainNumber: "2812", agency: "NMBS/SNCB", headsign: "Liège-Guillemins", track: "12" },
        { mode: "HIGHSPEED_RAIL", line: "EST 9126", trainNumber: "9126", agency: "Eurostar", headsign: "London St. Pancras Int." },
        { mode: "SUBURBAN", line: "S1", trainNumber: "1763", agency: "NMBS/SNCB", routeColor: "#006033", headsign: "Anvers-Central" },
      ]),
    );

    expect(rowsOf("sncb-board")).toEqual([
      "23:16 IC2812 Liège-Guillemins+5' Stop A 12",
      "05:50 EST9126 London St. Pancras Int.cancelled",
      "06:04 S1 Anvers-Central",
    ]);
  });

  it("shows the board of a Swiss station like the boards of the SBB", async () => {
    const app = await loadView("departures");
    await app.toolResult(
      { stopId: "S1" },
      countryBoard("Europe/Zurich", "Zürich HB", [
        { mode: "LONG_DISTANCE", line: "IC 727", trainNumber: "727", agency: "Schweizerische Bundesbahnen SBB", headsign: "St. Gallen", track: "32" },
        { mode: "REGIONAL_RAIL", line: "IR36", trainNumber: "2068", agency: "Schweizerische Bundesbahnen SBB", headsign: "Basel SBB", track: "16" },
        { mode: "SUBURBAN", line: "S12", trainNumber: "19252", agency: "Schweizerische Bundesbahnen SBB", headsign: "Brugg AG", track: "41/42" },
      ]),
    );

    // the number of a train named by its category only; the long-distance trains in red
    expect(rowsOf("sbb-board")).toEqual([
      "23:16 IC727 St. Gallen+5' Stop A 32",
      "05:50 IR36 Basel SBBcancelled 16",
      "06:04 S12 Brugg AG 41/42",
    ]);
    expect([...document.querySelectorAll("ol.sbb-board .piktogramm")].map((p) => p.classList.contains("fern"))).toEqual([true, false, false]);
  });

  it("shows the board of a Dutch station like the screens of the NS", async () => {
    const app = await loadView("departures");
    await app.toolResult(
      { stopId: "S1" },
      countryBoard("Europe/Amsterdam", "Amsterdam Centraal", [
        { mode: "HIGHSPEED_RAIL", line: "ICE 127", trainNumber: "127", agency: "NS International", headsign: "Frankfurt (M) Hbf", track: "2b" },
        { mode: "REGIONAL_RAIL", line: "Intercity", trainNumber: "2145", agency: "NS", headsign: "Den Haag Centraal", track: "2a" },
        { mode: "REGIONAL_RAIL", line: "Sprinter", trainNumber: "4053", agency: "NS", headsign: "Rotterdam Centraal", track: "10b" },
      ]),
    );

    // the delay next to the time, the type of train and its operator
    expect(rowsOf("ns-board")).toEqual([
      "23:16+5 Frankfurt (M) Hbf Stop A 2b ICENS International",
      "05:50 Den Haag Centraalcancelled 2a IntercityNS",
      "06:04 Rotterdam Centraal 10b SprinterNS",
    ]);
  });

  it("shows the board of a British station like the dot-matrix boards of National Rail", async () => {
    const app = await loadView("departures");
    await app.toolResult(
      { stopId: "S1" },
      countryBoard("Europe/London", "London Kings Cross", [
        { mode: "LONG_DISTANCE", line: "LNER", trainNumber: "GR232000", agency: "LNER", headsign: "Leeds", track: "5" },
        { mode: "REGIONAL_RAIL", line: "GN221600", trainNumber: "GN221600", agency: "Great Northern", headsign: "Cambridge", track: "10" },
        { mode: "SUBURBAN", line: "TL351900", trainNumber: "TL351900", agency: "Thameslink", headsign: "Brighton", track: "A" },
      ]),
    );

    // in the time zone of London; the time it is expected at when late, "on time" in real time
    expect(rowsOf("nr-board")).toEqual([
      "22:16 Leeds Stop A LNER 5 22:21",
      "04:50 Cambridge Great Northern 10 cancelled",
      "05:04 Brighton Thameslink A on time",
    ]);
  });
});
