import { describe, expect, it } from "vitest";
import { inTab, lineName, stationTabs } from "./stationTabs";
import type { StationLineDto, StopTimeDto } from "./types";

const line = (mode: string, name: string, agency = "RATP"): StationLineDto => ({ mode, line: name, agency });

describe("station tabs", () => {
  it("has a tab for the trains, each Île-de-France line, metros, trams and buses", () => {
    const tabs = stationTabs([
      line("BUS", "24"),
      line("REGIONAL_RAIL", "R", "Transilien"),
      line("SUBWAY", "14"),
      line("REGIONAL_RAIL", "D", "RER"),
      line("REGIONAL_RAIL", "D", "SNCF"),
      line("HIGHSPEED_RAIL", "TGV INOUI", "SNCF VOYAGEURS"),
      line("REGIONAL_RAIL", "A", "RER"),
      line("REGIONAL_RAIL", "TER", "SNCF"),
      line("TRAM", "T3a"),
      line("COACH", "FlixBus", "FlixBus"),
    ]);

    expect(tabs.map((tab) => tab.label)).toEqual(["Trains", "RER A", "RER D", "Transilien R", "Metro", "Tram", "Bus"]);
    // long-distance and regional trains together, without the Île-de-France lines
    expect(tabs[0]).toMatchObject({
      modes: ["HIGHSPEED_RAIL", "LONG_DISTANCE", "NIGHT_RAIL", "REGIONAL_FAST_RAIL", "REGIONAL_RAIL", "SUBURBAN"],
      lines: ["TGV INOUI", "TER"],
    });
    expect(tabs[1]).toMatchObject({ modes: ["REGIONAL_FAST_RAIL", "REGIONAL_RAIL", "SUBURBAN"], lines: ["A"] });
    expect(tabs[1].pictogram).toContain("<svg");
    expect(tabs[6].modes).toEqual(["BUS", "COACH"]);
  });

  it("has no tabs when the lines fit a single one", () => {
    expect(stationTabs([line("HIGHSPEED_RAIL", "TGV INOUI"), line("LONG_DISTANCE", "IC"), line("REGIONAL_RAIL", "TER")])).toEqual([]);
    expect(stationTabs([])).toEqual([]);
  });

  it("has a trains tab without line filter when the station has no Île-de-France line", () => {
    const [trains] = stationTabs([line("HIGHSPEED_RAIL", "TGV INOUI"), line("REGIONAL_RAIL", "TER"), line("BUS", "C3")]);

    expect(trains.label).toBe("Trains");
    expect(trains.lines).toBeUndefined();
  });

  it("tells the departures of a tab", () => {
    const [trains, rerA] = stationTabs([line("HIGHSPEED_RAIL", "TGV INOUI"), line("REGIONAL_RAIL", "A", "RER")]);
    const st = (mode: string, name: string) => ({ mode, line: name }) as StopTimeDto;

    expect(inTab(trains, st("HIGHSPEED_RAIL", "TGV INOUI 6633"))).toBe(true);
    expect(inTab(trains, st("REGIONAL_RAIL", "A"))).toBe(false);
    expect(inTab(rerA, st("REGIONAL_RAIL", "A"))).toBe(true);
    expect(inTab(rerA, st("REGIONAL_RAIL", "D"))).toBe(false);
    expect(lineName(" TER 891001 ")).toBe("TER");
    expect(lineName("TGV INOUI  6633")).toBe("TGV INOUI");
    expect(lineName("T3a")).toBe("T3a");
    expect(lineName("RE57")).toBe("RE57");
    expect(lineName("123")).toBe("123");
  });
});
