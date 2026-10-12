import { describe, expect, it } from "vitest";
import { $, FakeApp, fixture, flush, loadView } from "./test/host";
import type { DeparturesResult, TripResult } from "./shared/types";

/** Board of Lyon Part Dieu: the first train 3 min late on track 4, the second cancelled, the third on time. */
function board(): DeparturesResult {
  const data = fixture<DeparturesResult>("departures");
  Object.assign(data.stopTimes[0], { realTime: true, time: "2026-10-12T21:19:00Z", track: "4" });
  Object.assign(data.stopTimes[1], { cancelled: true });
  Object.assign(data.stopTimes[2], { realTime: true });
  return data;
}

const rows = () => [...document.querySelectorAll("tr[data-index]")].map((tr) => tr.textContent!.replace(/\s+/g, " ").trim());

describe("departures view", () => {
  it("shows the board with delays, tracks and cancellations", async () => {
    const app = await loadView("departures");
    await app.toolResult({ stop: "Lyon Part-Dieu", count: 3 }, board());

    expect($("#title").textContent).toBe("Lyon Part Dieu");
    expect($("#subtitle").textContent).toBe("Departures · Mon 12 Oct");
    expect(rows()).toEqual([
      "23:16 23:19 (+3) TGV INOUI 6633 Lyon PerracheSNCF VOYAGEURS track 4",
      "05:50 TGV INOUI 9852 Bruxelles Midi cancelledSNCF VOYAGEURS",
      "06:04 TGV INOUI 6602 Paris Gare de Lyon Hall 1 - 2SNCF VOYAGEURS",
    ]);
    expect($("#status").hidden).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect($("#fullscreen").hidden).toBe(false);
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
