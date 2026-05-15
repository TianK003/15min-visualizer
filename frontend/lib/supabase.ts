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

export async function amenitiesForPoint(lat: number, lng: number) {
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
    body: JSON.stringify({ p_lat: lat, p_lng: lng }),
  });
  if (!res.ok) throw new Error(`RPC ${res.status}`);
  return (await res.json()) as AmenityForPoint[];
}

export type CellScoreRow = {
  h3: string;
  score: number;
  walk_min: (number | null)[];
  bike_min: (number | null)[];
  population: number | null;
};

export async function cellScore(h3: string) {
  // Direct fetch for the same reason as amenitiesForPoint.
  const res = await fetch(
    `${url}/rest/v1/cell_scores?h3=eq.${encodeURIComponent(h3)}&select=h3,score,walk_min,bike_min,population`,
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

export async function obcinaGeom(naziv: string) {
  const res = await fetch(
    `${url}/rest/v1/obcine?naziv=eq.${encodeURIComponent(naziv)}&select=geom`,
    {
      headers: {
        apikey: anon!,
        Authorization: `Bearer ${anon}`,
        Accept: "application/json",
      },
    },
  );
  if (!res.ok) throw new Error(`obcine geom ${res.status}`);
  const data = await res.json();
  return data.length > 0 ? data[0].geom : null;
}

export type LlmSearchRow = {
  h3: string;
  score: number;
  population: number;
};

export async function llmSearchCells(filterSpec: any, limit: number = 5) {
  const res = await fetch(`${url}/rest/v1/rpc/llm_search_cells`, {
    method: "POST",
    headers: {
      apikey: anon!,
      Authorization: `Bearer ${anon}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filter_spec: filterSpec, p_limit: limit }),
  });
  if (!res.ok) throw new Error(`RPC llm_search_cells ${res.status} ${await res.text()}`);
  return (await res.json()) as LlmSearchRow[];
}
