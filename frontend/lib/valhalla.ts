// Valhalla client — used by the "Show 15-min reach" overlay (TASKS C4)
// and the path-to-amenity route renderer (TASKS C3).
//
// The base URL comes from NEXT_PUBLIC_VALHALLA_URL, set in .env.local. For
// local dev the existing Docker container at backend/valhalla/Dockerfile
// is reached at http://127.0.0.1:8002. For production a Railway URL goes
// here (TASKS A3, deferred).

// Browser goes through our Next.js proxy (/api/valhalla/*) to avoid CORS
// preflight against the Valhalla container, which doesn't handle OPTIONS.
// Override via NEXT_PUBLIC_VALHALLA_URL only if the upstream supports CORS.
const VALHALLA_URL = process.env.NEXT_PUBLIC_VALHALLA_URL ?? "/api/valhalla";

export type IsochroneOptions = {
  lat: number;
  lng: number;
  walkMin?: number;        // default 15
  costing?: "pedestrian" | "bicycle";
};

/** Returns a GeoJSON Feature with a Polygon — ready to drop into deck.gl's PolygonLayer. */
export async function isochrone({
  lat, lng, walkMin = 15, costing = "pedestrian",
}: IsochroneOptions): Promise<GeoJSON.Feature> {
  const res = await fetch(`${VALHALLA_URL}/isochrone`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      locations: [{ lat, lon: lng }],
      costing,
      contours: [{ time: walkMin }],
      polygons: true,
    }),
  });
  if (!res.ok) throw new Error(`Valhalla /isochrone ${res.status}`);
  const fc = (await res.json()) as GeoJSON.FeatureCollection;
  return fc.features[0];
}

export type RouteOptions = {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  costing?: "pedestrian" | "bicycle";
};

/** Returns the route's encoded polyline + summary. The path is decoded by the caller. */
export async function route({ from, to, costing = "pedestrian" }: RouteOptions) {
  const res = await fetch(`${VALHALLA_URL}/route`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      locations: [
        { lat: from.lat, lon: from.lng },
        { lat: to.lat, lon: to.lng },
      ],
      costing,
      directions_options: { units: "kilometers" },
    }),
  });
  if (!res.ok) throw new Error(`Valhalla /route ${res.status}`);
  return res.json() as Promise<{
    trip: {
      legs: Array<{ shape: string; summary: { time: number; length: number } }>;
    };
  }>;
}

export const VALHALLA_BASE = VALHALLA_URL;
