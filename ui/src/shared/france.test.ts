import { describe, expect, it } from "vitest";
import { tileInsideFrance } from "./france";

/** Web mercator tile of [lat, lon] at zoom [z]. */
function tile(lat: number, lon: number, z: number): [number, number, number] {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  return [z, Math.floor(((lon + 180) / 360) * n), Math.floor(((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * n)];
}

describe("tileInsideFrance", () => {
  it("is true for the tiles in metropolitan France and in Corsica", () => {
    expect(tileInsideFrance(...tile(48.8566, 2.3522, 12))).toBe(true); // Paris
    expect(tileInsideFrance(...tile(45.764, 4.8357, 14))).toBe(true); // Lyon
    expect(tileInsideFrance(...tile(43.2965, 5.3698, 12))).toBe(true); // Marseille
    expect(tileInsideFrance(...tile(41.9192, 8.7386, 12))).toBe(true); // Ajaccio
    expect(tileInsideFrance(...tile(46.0, 2.5, 8))).toBe(true); // centre, large tile
  });

  it("is false for the tiles abroad", () => {
    expect(tileInsideFrance(...tile(50.8503, 4.3517, 12))).toBe(false); // Brussels
    expect(tileInsideFrance(...tile(46.2044, 6.1432, 13))).toBe(false); // Geneva
    expect(tileInsideFrance(...tile(48.5703, 7.8155, 15))).toBe(false); // Kehl
    expect(tileInsideFrance(...tile(41.3874, 2.1686, 12))).toBe(false); // Barcelona
    expect(tileInsideFrance(...tile(51.1279, 1.3134, 12))).toBe(false); // Dover
  });

  it("is false for the tiles across a border, or too large", () => {
    expect(tileInsideFrance(...tile(47.5596, 7.5886, 10))).toBe(false); // Basel, with Saint-Louis
    expect(tileInsideFrance(...tile(46.2, 6.1, 9))).toBe(false); // Geneva and the Genevois
    expect(tileInsideFrance(...tile(46.5, 2.5, 5))).toBe(false); // the whole of France
  });
});
