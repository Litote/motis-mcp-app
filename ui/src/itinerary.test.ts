import { describe, expect, it } from "vitest";
import { $, fixture, flush, loadView } from "./test/host";
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

    expect($("#title").textContent).toBe("START → END");
    expect($("#subtitle").textContent).toBe("Mon 12 Oct");
    expect(items("#itineraries li")).toEqual([
      "23:10 → 23:32 22 min · 0 transfer(s) C23",
      "23:14 → 23:38 24 min · 0 transfer(s) TB11",
      "23:18 → 23:40 22 min · 0 transfer(s) C13",
      "23:10 → 23:32 22 min · 0 transfer(s) · direct Walk",
    ]);
    expect($("#itineraries li.selected").dataset.index).toBe("0");
    const legs = items("#legs > li");
    expect(legs[0]).toBe("23:10 START Walk 562 m (8 min)");
    expect(legs[1]).toBe("23:18 Part-Dieu Jules Favre C23 → Cité Internationale4 stop(s) · TCL");
    expect(legs.at(-1)).toBe("23:32 END");
    expect($<HTMLButtonElement>("#earlier").disabled).toBe(false);
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
    expect($("#title").textContent).toBe("START → END");
  });
});
