// Tiny 2D point-in-polygon helpers. Used by:
//   • Scorecard — to clip the per-mode amenity set to the user-centered iso
//     polygon so the rendered dots match what the polygon visually says is
//     reachable.
//   • Map     — to identify the občina under the viewport center (top-left
//     indicator), running against the loaded obcine GeoJSON on every
//     `moveend`. Brute force across 212 polygons is well under 1 ms.
//
// Holes are intentionally not handled — Valhalla pedestrian/bike isos don't
// currently emit interior rings, and the GURS občine boundaries are simple
// polygons / multipolygons without holes meaningful at the country scale.

export function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      (yi > lat) !== (yj > lat) &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInFeature(lng: number, lat: number, f: GeoJSON.Feature): boolean {
  const g = f.geometry;
  if (g.type === "Polygon") {
    return pointInRing(lng, lat, g.coordinates[0]);
  }
  if (g.type === "MultiPolygon") {
    return g.coordinates.some((poly) => pointInRing(lng, lat, poly[0]));
  }
  return false;
}
