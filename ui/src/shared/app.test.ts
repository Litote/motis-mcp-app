import { describe, expect, it } from "vitest";
import { structuredData } from "./app";

const path = (points: string) => ({ points, precision: 6 });
const leg = (mode: string) => ({ mode });

describe("structuredData", () => {
  it("puts the paths of the legs back from the _meta of the result", () => {
    const data = structuredData({
      structuredContent: {
        kind: "journey",
        itineraries: [{ legs: [leg("WALK"), leg("BUS")] }, { legs: [leg("TRAM")] }],
        direct: [{ legs: [leg("WALK")] }],
      },
      _meta: { legPolylines: { itineraries: [[path("a"), path("b")], [path("c")]], direct: [[path("d")]] } },
    });

    expect(data).toEqual({
      kind: "journey",
      itineraries: [
        { legs: [{ mode: "WALK", polyline: path("a") }, { mode: "BUS", polyline: path("b") }] },
        { legs: [{ mode: "TRAM", polyline: path("c") }] },
      ],
      direct: [{ legs: [{ mode: "WALK", polyline: path("d") }] }],
    });
  });

  it("puts the paths back in the itinerary of a trip", () => {
    const data = structuredData({
      structuredContent: { kind: "trip", tripId: "t", itinerary: { legs: [leg("RAIL")] } },
      _meta: { legPolylines: { itinerary: [path("e")] } },
    });

    expect(data?.itinerary).toEqual({ legs: [{ mode: "RAIL", polyline: path("e") }] });
  });

  it("keeps a result without paths in its _meta as it is", () => {
    const structuredContent = { kind: "journey", itineraries: [{ legs: [{ mode: "BUS", polyline: path("f") }] }], direct: [] };

    expect(structuredData({ structuredContent })).toBe(structuredContent);
    expect(structuredData({ structuredContent, _meta: { other: 1 } })).toBe(structuredContent);
    expect(structuredData({})).toBeUndefined();
  });

  it("puts back the fields for the view only, replacing those given to the model", () => {
    const data = structuredData({
      structuredContent: { kind: "area", title: "Lyon", stops: [{ name: "A", stopId: "a" }] },
      _meta: { view: { stops: [{ name: "A", stopId: "a", lat: 45, lon: 4 }], polylines: [{ routeIdx: [1] }] } },
    });

    expect(data).toEqual({
      kind: "area",
      title: "Lyon",
      stops: [{ name: "A", stopId: "a", lat: 45, lon: 4 }],
      polylines: [{ routeIdx: [1] }],
    });
  });
});
