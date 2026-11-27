import { describe, expect, it } from "vitest";
import { legColors, lineColor, shade } from "./format";
import { SNCF_BOARD_BLUE } from "./sncf";

describe("colors of the lines", () => {
  it("colors a line like its badge", () => {
    // logo of the brand on the blue of the SNCF boards, not the red of the high-speed trains
    expect(lineColor("HIGHSPEED_RAIL", "TGV INOUI 9573", null, "SNCF VOYAGEURS")).toBe(SNCF_BOARD_BLUE);
    // pictogram of an Île-de-France line
    expect(lineColor("SUBURBAN", "B", null, "RER")).toBe("#5291ce");
    // color of the route, else of the mode
    expect(lineColor("HIGHSPEED_RAIL", "ICE 9553", "#ec0016", "DB Fernverkehr AG")).toBe("#ec0016");
    expect(lineColor("HIGHSPEED_RAIL", "ICE 9553", null, "DB Fernverkehr AG")).toBe("#c92a2a");
  });

  it("shades a color towards white or black", () => {
    expect(shade("#000000", 0.5)).toBe("#808080");
    expect(shade("#fff", -0.5)).toBe("#808080");
    expect(shade("not a color", 0.5)).toBe("not a color");
  });

  it("shades a vehicle of the same color as the previous one", () => {
    const ice = { mode: "HIGHSPEED_RAIL", line: "ICE", routeColor: "#ec0016", tripId: "t" };
    const walk = { mode: "WALK" };
    const [first, , second, third, , ter] = legColors([
      ice,
      walk,
      ice,
      ice,
      { mode: "HIGHSPEED_RAIL", line: "TGV INOUI 9573", agency: "SNCF VOYAGEURS", tripId: "t" },
      { mode: "REGIONAL_RAIL", line: "TER", routeColor: "#ec0016", tripId: "t" },
    ]);
    expect(first).toBe("#ec0016");
    expect(second).not.toBe("#ec0016");
    expect(third).toBe("#ec0016");
    // after a train of another color
    expect(ter).toBe("#ec0016");
  });
});
