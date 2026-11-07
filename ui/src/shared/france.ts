// Simplified outline of metropolitan France and Corsica ([lon, lat]), slightly inside the land borders: a tile is
// "in France" when its 4 corners are inside and no vertex of the outline is in the tile (concave borders, e.g. Geneva).
// It chooses the French rail overlay (IGN, French railways only) over the world one: a tile across a border takes the
// world one, which also draws the railways of the neighbours. The sea coasts are loose: no railway at sea.

type Ring = ReadonlyArray<readonly [number, number]>;

const MAINLAND: Ring = [
  [2.53, 51.03], [2.62, 50.8], [2.95, 50.7], [3.15, 50.75], [3.25, 50.55], [3.6, 50.35], [4.05, 50.3], [4.15, 50.0],
  [4.75, 49.9], [4.9, 49.75], [5.4, 49.58], [5.85, 49.48], [6.35, 49.42], [6.7, 49.18], [7.05, 49.08], [7.6, 49.03],
  [8.0, 48.95], [7.7, 48.45], [7.5, 47.95], [7.5, 47.55], [7.0, 47.45], [6.85, 47.3], [6.4, 46.95], [6.08, 46.58],
  [6.05, 46.38], [5.95, 46.13], [6.25, 46.08], [6.45, 46.25], [6.8, 46.33], [6.82, 46.1], [6.9, 45.85], [6.95, 45.5],
  [6.95, 45.25], [6.65, 45.12], [6.7, 44.95], [6.85, 44.8], [6.9, 44.35], [7.55, 44.12], [7.45, 43.9], [7.38, 43.78],
  [7.0, 43.4], [6.2, 42.95], [5.0, 43.15], [4.0, 43.35], [3.2, 42.9], [3.12, 42.47], [2.5, 42.38], [1.8, 42.6],
  [1.4, 42.72], [0.7, 42.85], [-0.3, 42.85], [-0.75, 42.95], [-1.4, 43.05], [-1.75, 43.33], [-1.9, 43.45],
  [-1.5, 44.5], [-1.4, 45.5], [-2.6, 46.8], [-3.0, 47.3], [-4.6, 47.7], [-5.2, 48.4], [-4.0, 48.9], [-2.0, 48.75],
  [-1.95, 49.75], [-1.2, 49.75], [0.0, 49.6], [1.4, 50.1], [1.55, 50.85], [2.0, 51.0],
];

const CORSICA: Ring = [
  [9.45, 43.05], [9.6, 42.6], [9.45, 41.95], [9.3, 41.4], [9.1, 41.36], [8.7, 41.65], [8.55, 42.1], [8.55, 42.45],
  [9.0, 42.8], [9.3, 43.05],
];

/** Bounding box of the outlines: [[south, west], [north, east]]. */
export const FRANCE_BOUNDS: [[number, number], [number, number]] = [
  [41.36, -5.2],
  [51.03, 9.6],
];

/** Ray casting: true when [lon, lat] is inside [ring]. */
function inside(ring: Ring, lon: number, lat: number): boolean {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) result = !result;
  }
  return result;
}

function tileLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

function tileLat(y: number, z: number): number {
  return (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;
}

/** True when the web mercator tile [z]/[x]/[y] is entirely in metropolitan France or in Corsica. */
export function tileInsideFrance(z: number, x: number, y: number): boolean {
  const west = tileLon(x, z);
  const east = tileLon(x + 1, z);
  const north = tileLat(y, z);
  const south = tileLat(y + 1, z);
  const corners = [
    [west, north],
    [east, north],
    [east, south],
    [west, south],
  ];
  return [MAINLAND, CORSICA].some(
    (ring) =>
      corners.every(([lon, lat]) => inside(ring, lon, lat)) &&
      !ring.some(([lon, lat]) => lon > west && lon < east && lat > south && lat < north),
  );
}
