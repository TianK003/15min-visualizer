// Valhalla client. Locked speeds:
//   walking : 4 km/h   (NEXT_PUBLIC_WALKING_SPEED override)
//   biking  : 13 km/h  (NEXT_PUBLIC_CYCLING_SPEED override)
// Bicycle uses bicycle_type=Hybrid for general-purpose urban routing.
//
// Browser goes through our Next.js proxy (/api/valhalla/*) to avoid CORS
// preflight against the Valhalla container, which doesn't handle OPTIONS.

const VALHALLA_URL = process.env.NEXT_PUBLIC_VALHALLA_URL ?? "/api/valhalla";

const WALKING_SPEED = Number(process.env.NEXT_PUBLIC_WALKING_SPEED ?? 4);
const CYCLING_SPEED = Number(process.env.NEXT_PUBLIC_CYCLING_SPEED ?? 13);

type Costing = "pedestrian" | "bicycle";

function costingOptions(costing: Costing) {
  if (costing === "pedestrian") {
    return { pedestrian: { walking_speed: WALKING_SPEED } };
  }
  return { bicycle: { bicycle_type: "Hybrid", cycling_speed: CYCLING_SPEED } };
}

export type IsochroneOptions = {
  lat: number;
  lng: number;
  minutes?: number;       // default 15
  costing?: Costing;
};

/** Returns a GeoJSON Feature with a Polygon — ready for deck.gl. */
export async function isochrone({
  lat, lng, minutes = 15, costing = "pedestrian",
}: IsochroneOptions): Promise<GeoJSON.Feature> {
  const res = await fetch(`${VALHALLA_URL}/isochrone`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      locations: [{ lat, lon: lng }],
      costing,
      costing_options: costingOptions(costing),
      contours: [{ time: minutes }],
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
  costing?: Costing;
};

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
      costing_options: costingOptions(costing),
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

/** One-to-many travel-time matrix. Used by the Scorecard to refine the
 *  pre-baked 5-min-step `walk_min` values (from `amenities_for_point`, which
 *  reads the 5/10/15-min isochrone bake) to true Valhalla minute-accurate
 *  times. Returns rounded minutes per target, or `null` for unreachable
 *  targets. Falls within the same `costing_options` (locked walking / cycling
 *  speeds) as the existing isochrone and route helpers.
 *
 *  Goes through the Next.js proxy at /api/valhalla/sources_to_targets — see
 *  the proxy's ALLOWED set. */
export async function timeMatrix(
  source: { lat: number; lng: number },
  targets: Array<{ lat: number; lng: number }>,
  costing: Costing = "pedestrian",
): Promise<Array<number | null>> {
  if (targets.length === 0) return [];
  const res = await fetch(`${VALHALLA_URL}/sources_to_targets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sources: [{ lat: source.lat, lon: source.lng }],
      targets: targets.map((t) => ({ lat: t.lat, lon: t.lng })),
      costing,
      costing_options: costingOptions(costing),
    }),
  });
  if (!res.ok) throw new Error(`Valhalla /sources_to_targets ${res.status}`);
  const data = (await res.json()) as {
    sources_to_targets: Array<Array<{ time: number | null }>>;
  };
  const row = data.sources_to_targets?.[0] ?? [];
  return row.map((c) => (c.time === null || c.time === undefined ? null : c.time / 60));
}

export const VALHALLA_BASE = VALHALLA_URL;
