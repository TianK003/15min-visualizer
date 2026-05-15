import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anon) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
      "Set them in frontend/.env.local (see `supabase status --output env` for local).",
  );
}

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) client = createClient(url!, anon!);
  return client;
}

export const SUPABASE_URL = url;
export const STORAGE_BASE = `${url}/storage/v1/object/public`;

export type AmenityForPoint = {
  amenity_id: number;
  category: string;
  name: string | null;
  walk_min: number;
  lat: number;
  lng: number;
};

/** OSM often duplicates the same store as both `shop=supermarket` and
 *  `building=retail`, or two surveys add the same point twice. Collapse any
 *  pair within this radius that shares the same name (case-insensitive). */
const DEDUPE_RADIUS_M = 20;

function metersBetween(a: AmenityForPoint, b: AmenityForPoint): number {
  // Equirectangular approximation — accurate to ~0.2% at 46°N for 20 m.
  const latRad = (a.lat * Math.PI) / 180;
  const dLat = (a.lat - b.lat) * 111_320;
  const dLng = (a.lng - b.lng) * 111_320 * Math.cos(latRad);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

function dedupeNearby(rows: AmenityForPoint[]): AmenityForPoint[] {
  const kept: AmenityForPoint[] = [];
  for (const a of rows) {
    if (!a.name) {
      kept.push(a);
      continue;
    }
    const key = a.name.trim().toLowerCase();
    const dup = kept.some(
      (k) =>
        k.name &&
        k.name.trim().toLowerCase() === key &&
        metersBetween(a, k) < DEDUPE_RADIUS_M,
    );
    if (!dup) kept.push(a);
  }
  return kept;
}

export async function amenitiesForPoint(
  lat: number,
  lng: number,
  mode: "pedestrian" | "bicycle" = "pedestrian",
) {
  // Direct PostgREST fetch — supabase-js's `.rpc()` was hanging on the local
  // stack under React strict mode (probably the realtime/auth probes never
  // settling). The REST surface works fine without those layers.
  const res = await fetch(`${url}/rest/v1/rpc/amenities_for_point`, {
    method: "POST",
    headers: {
      apikey: anon!,
      Authorization: `Bearer ${anon}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_lat: lat, p_lng: lng, p_mode: mode }),
  });
  if (!res.ok) throw new Error(`RPC ${res.status}`);
  const raw = (await res.json()) as AmenityForPoint[];
  return dedupeNearby(raw);
}

export type CellScoreRow = {
  h3: string;
  walk_score: number;
  bike_score: number;
  walk_min: (number | null)[];
  bike_min: (number | null)[];
  population: number | null;
};

export async function cellScore(h3: string) {
  const res = await fetch(
    `${url}/rest/v1/cell_scores?h3=eq.${encodeURIComponent(h3)}&select=h3,walk_score,bike_score,walk_min,bike_min,population`,
    {
      headers: {
        apikey: anon!,
        Authorization: `Bearer ${anon}`,
        Accept: "application/vnd.pgrst.object+json",
      },
    },
  );
  if (!res.ok) throw new Error(`cell_scores ${res.status}`);
  return (await res.json()) as CellScoreRow;
}
