import { describe, expect, it } from "vitest";
import { $, FakeApp, fixture, flush, loadView } from "./test/host";
import type { JourneyResult } from "./shared/types";

const items = (selector: string) => [...document.querySelectorAll(selector)].map((el) => el.textContent!.replace(/\s+/g, " ").trim());

/** Journey with the second itinerary in real time, 2 min late, and a direct walk. */
function journey(): JourneyResult {
  const data = fixture<JourneyResult>("journey");
  const bus = data.itineraries[1].legs[1];
  Object.assign(bus, { realTime: true, startTime: new Date(Date.parse(bus.scheduledStartTime) + 120_000).toISOString() });
  bus.from.track = "B";
  data.direct = [{ ...data.itineraries[0], transfers: 0, legs: [data.itineraries[0].legs[0]] }];
  return data;
}

describe("itinerary view", () => {
  it("lists the itineraries and shows the first one", async () => {
    const app = await loadView("itinerary");
    await app.toolResult({ from: "45.7605,4.8597", to: "45.7676,4.8344" }, journey());

    expect($("#title").textContent).toBe("Start → Destination");
    expect($("#subtitle").textContent).toBe("Mon 12 Oct");
    expect(items("#itineraries li")).toEqual([
      "23:10 → 23:32 22 min · 0 transfer(s) C23",
      "23:14 → 23:38 24 min · 0 transfer(s) TB11",
      "23:18 → 23:40 22 min · 0 transfer(s) C13",
      "23:10 → 23:32 22 min · 0 transfer(s) · direct Walk",
    ]);
    expect($("#itineraries li.selected").dataset.index).toBe("0");
    const legs = items("#legs > li");
    expect(legs[0]).toBe("23:10 Start Walk 562 m (8 min)");
    expect(legs[1]).toBe("23:18 Part-Dieu Jules Favre C23 → Cité Internationale4 stop(s) · TCL");
    expect(legs.at(-1)).toBe("23:32 Destination");
    expect($<HTMLButtonElement>("#earlier").disabled).toBe(false);
  });

  it("names the ends given as coordinates in the language of the host", async () => {
    FakeApp.nextLocale = "fr-FR";
    const app = await loadView("itinerary");
    await app.toolResult({}, journey());

    expect($("#title").textContent).toBe("Départ → Arrivée");
    expect(items("#legs > li").at(-1)).toBe("23:32 Arrivée");
  });

  it("keeps the names of the places asked", async () => {
    const app = await loadView("itinerary");
    const data = journey();
    data.from.name = "Gare de Lyon";
    await app.toolResult({}, data);

    expect($("#title").textContent).toBe("Gare de Lyon → Destination");
  });

  it("tells the area of the places asked, unless their name does", async () => {
    const app = await loadView("itinerary");
    const data = journey();
    Object.assign(data.from, { name: "Saint Michel", area: "Bordeaux" });
    Object.assign(data.to, { name: "Lyon Part-Dieu", area: "Lyon" });
    await app.toolResult({}, data);

    expect($("#title").textContent).toBe("Saint Michel (Bordeaux) → Lyon Part-Dieu");
  });

  it("selects an itinerary, with its delays", async () => {
    const app = await loadView("itinerary");
    await app.toolResult({}, journey());

    (document.querySelector("#itineraries li[data-index='1']") as HTMLElement).click();

    expect($("#itineraries li.selected").dataset.index).toBe("1");
    expect(items("#legs > li")[1]).toMatch(/^23:\d\d \+2 .+ TB11 → .+ · track B/);
  });

  it("pages with the arguments of the call", async () => {
    const app = await loadView("itinerary");
    await app.toolResult({ from: "a", to: "b", pageCursor: "OLD" }, journey());
    app.answer({ ...journey(), itineraries: [], direct: [], previousPageCursor: undefined, nextPageCursor: undefined });

    $("#later").click();
    await flush();

    expect(app.callServerTool).toHaveBeenLastCalledWith({ name: "plan_journey", arguments: { from: "a", to: "b", pageCursor: "LATER|1791839940" } });
    expect(items("#itineraries li")).toEqual(["No itinerary found."]);
    expect($("#legs").innerHTML).toBe("");
    expect($<HTMLButtonElement>("#later").disabled).toBe(true);

    // no page left
    $("#earlier").click();
    await flush();
    expect(app.callServerTool).toHaveBeenCalledOnce();
  });

  it("reports a failed page", async () => {
    const app = await loadView("itinerary");
    await app.toolResult({}, journey());
    app.answer(new Error("MOTIS error: no route"));

    $("#earlier").click();
    await flush();

    expect($("#status").textContent).toBe("MOTIS error: no route");
    expect($("#title").textContent).toBe("Start → Destination");
  });

  describe("options panel", () => {
    const field = <T extends HTMLInputElement | HTMLSelectElement>(name: string) =>
      ($<HTMLFormElement>("#options").elements.namedItem(name) as T);
    const checkedModes = () =>
      [...document.querySelectorAll<HTMLInputElement>("#options input[name=mode]")].filter((b) => b.checked).map((b) => b.value);
    const search = async (app: FakeApp) => {
      app.answer(journey());
      $<HTMLFormElement>("#options").requestSubmit();
      await flush();
    };

    it("is hidden until toggled", async () => {
      await loadView("itinerary");

      expect($("#options").hidden).toBe(true);
      $("#options-toggle").click();
      expect($("#options").hidden).toBe(false);
      expect($("#options-toggle").getAttribute("aria-expanded")).toBe("true");
    });

    it("is filled with the arguments of the call", async () => {
      const app = await loadView("itinerary");
      await app.toolResult(
        {
          from: "a",
          to: "b",
          arriveBy: true,
          modes: ["REGIONAL_RAIL", "BUS"],
          maxTransfers: 1,
          maxWalkMinutes: 10,
          walkingSpeed: "slow",
          wheelchair: true,
          transferMargin: "COMFORTABLE",
          bike: "ON_BOARD",
        },
        journey(),
      );

      expect(field("arriveBy").value).toBe("true");
      expect(checkedModes()).toEqual(["train", "bus"]);
      expect(field("maxTransfers").value).toBe("1");
      expect(field("maxWalkMinutes").value).toBe("10");
      expect(field("walkingSpeed").value).toBe("SLOW");
      expect(field<HTMLInputElement>("wheelchair").checked).toBe(true);
      expect(field("transferMargin").value).toBe("COMFORTABLE");
      expect(field("bike").value).toBe("ON_BOARD");
    });

    it("has the default values without arguments", async () => {
      const app = await loadView("itinerary");
      await app.toolResult({ from: "a", to: "b" }, journey());

      expect(field("arriveBy").value).toBe("false");
      expect(field("time").value).toBe("");
      expect(checkedModes()).toEqual(["train", "metro", "tram", "bus", "ferry", "other"]);
      expect(field("maxTransfers").value).toBe("");
      expect(field("maxWalkMinutes").value).toBe("25");
      expect(field("walkingSpeed").value).toBe("NORMAL");
      expect(field("bike").value).toBe("NONE");
    });

    it("searches again with the options, and tells the model", async () => {
      const app = await loadView("itinerary");
      await app.toolResult({ from: "a", to: "b", language: "fr", pageCursor: "OLD" }, journey());
      field("maxWalkMinutes").value = "15";
      field("walkingSpeed").value = "FAST";
      field<HTMLInputElement>("wheelchair").checked = true;
      field("bike").value = "TO_STATION";
      field("time").value = "2026-10-15T08:00";
      document.querySelector<HTMLInputElement>("#options input[value=bus]")!.checked = false;

      await search(app);

      expect(app.callServerTool).toHaveBeenLastCalledWith({
        name: "plan_journey",
        arguments: {
          from: "a",
          to: "b",
          language: "fr",
          time: new Date("2026-10-15T08:00").toISOString(),
          modes: ["RAIL", "HIGHSPEED_RAIL", "LONG_DISTANCE", "NIGHT_RAIL", "REGIONAL_FAST_RAIL", "REGIONAL_RAIL", "SUBURBAN", "SUBWAY", "TRAM", "FERRY", "FUNICULAR", "AERIAL_LIFT", "AIRPLANE", "OTHER"],
          maxWalkMinutes: 15,
          walkingSpeed: "FAST",
          wheelchair: true,
          bike: "TO_STATION",
        },
      });
      expect(items("#itineraries li")).toHaveLength(4);
      expect(app.updateModelContext).toHaveBeenCalledOnce();
      const text = app.updateModelContext.mock.calls[0][0].content[0].text;
      expect(text).toMatch(/^The user changed the options in the journey planner view: plan_journey was called again with \{"from":"a"/);
      expect(text).toMatch(/\n$/);

      // the next pages keep the options
      app.answer(journey());
      $("#later").click();
      await flush();
      expect(app.callServerTool.mock.lastCall![0].arguments).toMatchObject({ walkingSpeed: "FAST", bike: "TO_STATION" });
    });

    it("keeps the modes of the call when they are not changed", async () => {
      const app = await loadView("itinerary");
      await app.toolResult({ from: "a", to: "b", modes: ["REGIONAL_RAIL"], maxTransfers: 2 }, journey());
      field("maxTransfers").value = "";

      await search(app);

      expect(app.callServerTool).toHaveBeenLastCalledWith({ name: "plan_journey", arguments: { from: "a", to: "b", modes: ["REGIONAL_RAIL"] } });
    });

    it("searches from the places of the result without arguments", async () => {
      const app = await loadView("itinerary");
      await app.toolResult({}, journey());

      await search(app);

      const data = journey();
      expect(app.callServerTool).toHaveBeenLastCalledWith({
        name: "plan_journey",
        arguments: { from: `${data.from.lat},${data.from.lon}`, to: `${data.to.lat},${data.to.lon}` },
      });
    });

    it("requires a transport mode", async () => {
      const app = await loadView("itinerary");
      await app.toolResult({ from: "a", to: "b" }, journey());
      document.querySelectorAll<HTMLInputElement>("#options input[name=mode]").forEach((b) => (b.checked = false));

      $<HTMLFormElement>("#options").requestSubmit();
      await flush();

      expect(app.callServerTool).not.toHaveBeenCalled();
      expect($("#status").textContent).toBe("Select at least one transport mode.");
    });

    it("does not update the model context of a host without it, nor after a failed search", async () => {
      const app = await loadView("itinerary");
      await app.toolResult({ from: "a", to: "b" }, journey());
      app.hostCapabilities = { serverTools: {} };
      await search(app);
      expect(app.updateModelContext).not.toHaveBeenCalled();

      app.hostCapabilities = { serverTools: {}, updateModelContext: {} };
      app.answer(new Error("MOTIS error: no route"));
      $<HTMLFormElement>("#options").requestSubmit();
      await flush();
      expect($("#status").textContent).toBe("MOTIS error: no route");
      expect(app.updateModelContext).not.toHaveBeenCalled();
    });
  });
});
