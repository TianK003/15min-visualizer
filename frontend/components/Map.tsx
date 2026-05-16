"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer } from "@deck.gl/core";
import { GeoJsonLayer, IconLayer, TextLayer, ScatterplotLayer } from "@deck.gl/layers";
import { H3HexagonLayer, TripsLayer } from "@deck.gl/geo-layers";
import * as h3 from "h3-js";
import Scorecard, { type RouteSet, type RoutePath } from "@/components/Scorecard";
import ObcinaInfoCard, { type ObcinaInfo } from "@/components/ObcinaInfoCard";
import AddressSearch, { type AddressSearchHandle } from "@/components/AddressSearch";
import IzvorPodatkov from "@/components/IzvorPodatkov";
import ChatBox from "@/components/ChatBox";
import ResultCard from "@/components/ResultCard";
import type { SearchResult } from "@/lib/llm-search";
import ThemeToggle from "@/components/ThemeToggle";
import { categoryById, CATEGORIES, ICON_HOME } from "@/lib/categories";
import type { AmenityForPoint } from "@/lib/supabase";
import { useTheme } from "@/lib/theme";
import { ZONE_REASONS, type Suggestion, type BoostKind } from "@/lib/suggestions";
import { pointInFeature } from "@/lib/geo";

type GroupedPin = {
  lat: number;
  lng: number;
  zoneCode: string;
  zoneDesc: string;
  items: Suggestion[];
  // All items in a group share lat/lng → same občina → same kind. Hoisted to
  // the group level so the ScatterplotLayer's getFillColor doesn't have to
  // peek into items[0] for every paint.
  boostKind?: BoostKind;
};

// Path color is derived per-render from the active category (see layers effect).
// α 0.6 (153/255) keeps the path readable while letting the basemap show through.
const PATH_ALPHA = 153;
const FALLBACK_RGB: [number, number, number] = [120, 120, 120];
const DOT_HALO: [number, number, number, number] = [255, 255, 255, 230];

// Inline SVG mask for the origin pin (a modern monochrome house). White fill
// on a transparent background; IconLayer uses `mask: true` so the alpha
// channel is preserved and `getColor` tints the visible pixels.
const HOME_ICON_URL = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="white"><path d="${ICON_HOME}"/></svg>`,
)}`;
const HOME_ICON_MAPPING = {
  home: { x: 0, y: 0, width: 48, height: 48, mask: true },
} as const;

// Positron is OpenFreeMap's clean grayscale style — desaturated, no green
// parks / yellow roads. Lets the data colors (score buckets, demand heat)
// own the canvas. Parking-class POIs are still filtered defensively in
// harmonizeBasemap on the chance Positron exposes them; the loop is a
// no-op if the layers don't exist.
const BASEMAP_LIGHT = "https://tiles.openfreemap.org/styles/positron";
const BASEMAP_DARK = "https://tiles.openfreemap.org/styles/dark-matter";

// Liberty buckets POIs into rank tiers (poi_r1, poi_r7, poi_r20) — they're
// all the same symbol layer reading `class` from the vector tile. Adding
// `class != parking` to each filter is what kills the "P" icons.
const POI_RANK_LAYER = /^poi_r\d+$/;
const NO_PARKING_CLAUSE: maplibregl.FilterSpecification = [
  "!=",
  ["get", "class"],
  "parking",
];

function filterAlreadyExcludesParking(filter: unknown): boolean {
  return JSON.stringify(filter).includes(JSON.stringify(NO_PARKING_CLAUSE));
}

const DARK_MAP_FACTOR = 0.55;

function parseRgb(s: string): [number, number, number, number?] | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (t.startsWith("#")) {
    const hex = t.slice(1);
    if (hex.length === 3) return [parseInt(hex[0]+hex[0],16), parseInt(hex[1]+hex[1],16), parseInt(hex[2]+hex[2],16)];
    if (hex.length === 6) return [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)];
    if (hex.length === 8) return [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16), parseInt(hex.slice(6,8),16)/255];
    return null;
  }
  const m = t.match(/^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/i);
  if (m) return [+m[1], +m[2], +m[3], m[4] != null ? +m[4] : undefined];
  return null;
}

function darkenPaintValue(v: unknown, factor: number): unknown {
  if (typeof v === "string") {
    const rgb = parseRgb(v);
    if (!rgb) return v;
    const [r, g, b, a] = rgb;
    const dr = Math.round(r * factor), dg = Math.round(g * factor), db = Math.round(b * factor);
    return a != null ? `rgba(${dr},${dg},${db},${a})` : `rgb(${dr},${dg},${db})`;
  }
  if (Array.isArray(v)) return v.map((x) => darkenPaintValue(x, factor));
  return v;
}

let darkBasemapCache: unknown = null;
async function loadDarkBasemap(): Promise<unknown> {
  if (darkBasemapCache) return darkBasemapCache;
  const res = await fetch(BASEMAP_DARK);
  const style = await res.json();
  const SKIP = new Set(["text-color", "text-halo-color", "icon-color", "icon-halo-color"]);
  for (const layer of style.layers ?? []) {
    const paint = layer.paint as Record<string, unknown> | undefined;
    if (!paint) continue;
    for (const key of Object.keys(paint)) {
      if (SKIP.has(key)) continue;
      if (key === "background-color" || key.endsWith("-color")) {
        paint[key] = darkenPaintValue(paint[key], DARK_MAP_FACTOR);
      }
    }
  }
  darkBasemapCache = style;
  return darkBasemapCache;
}

function harmonizeBasemap(map: maplibregl.Map) {
  const style = map.getStyle();
  if (!style?.layers) return;
  for (const layer of style.layers) {
    // Disable 3D — strip every fill-extrusion (Liberty has `building-3d`).
    // Map is locked to maxPitch: 0, so extrusions would never render anyway.
    if (layer.type === "fill-extrusion") {
      try {
        map.removeLayer(layer.id);
      } catch {
        // The layer was missing in some downstream style — ignore.
      }
      continue;
    }
    const id = layer.id;
    // Append `class != parking` to every POI rank layer's filter — kills the
    // "P" icons without touching any other POI. Idempotent: if we've already
    // wrapped this filter once, skip (styledata fires every theme swap).
    if (POI_RANK_LAYER.test(id) && layer.type === "symbol") {
      try {
        const existing = map.getFilter(id);
        if (!filterAlreadyExcludesParking(existing)) {
          // MapLibre's FilterSpecification has a legacy/expression split that
          // TS can't statically narrow when we compose two arbitrary specs
          // under ["all", …]. Cast through unknown — runtime check above
          // guarantees we only wrap once.
          const next = (
            existing ? ["all", existing, NO_PARKING_CLAUSE] : NO_PARKING_CLAUSE
          ) as unknown as maplibregl.FilterSpecification;
          map.setFilter(id, next);
        }
      } catch {
        // Filter shape varies between style versions — best-effort.
      }
    }
  }
}

// Data source switch: when NEXT_PUBLIC_USE_REMOTE_DATA="true", read from
// the Supabase Storage URLs (live backend). Otherwise fall back to the
// static files under public/data/ — keeps dev working without supabase.
const REMOTE_DATA = process.env.NEXT_PUBLIC_USE_REMOTE_DATA === "true";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const STORAGE = `${SUPABASE_URL}/storage/v1/object/public`;
const OBCINE_URL = REMOTE_DATA
  ? `${STORAGE}/overlays/obcine_scored.geojson`
  : "/data/obcine_scored.geojson";
const SCORES_URL = REMOTE_DATA
  ? `${STORAGE}/cells/cell_scores_lite.json`
  : "/data/cell_scores_lite.json";
const DEMAND_URL = REMOTE_DATA
  ? `${STORAGE}/cells/cell_demand_lite.json`
  : "/data/cell_demand_lite.json";
const PROTECTED_URL = REMOTE_DATA
  ? `${STORAGE}/overlays/zavarovana_si.geojson`
  : "/data/zavarovana_si.geojson";
// Always served locally — pairs with `building_suggestions.json` (also
// fetched from /data/ regardless of REMOTE_DATA) and the file is tiny
// (~8 KB), so there's no reason to round-trip through Supabase Storage.
const DEMOGRAPHICS_URL = "/data/obcine_demographics.json";

// Suggestion pins located in an občina whose relevant demographic exceeds
// the threshold below are painted blue (instead of red FRO / yellow OPN)
// and their tooltip explains the boost. Thresholds are fractions of total
// population (e.g. 0.25 = 25 %). Set a threshold to 1.0 to disable that
// category's boost entirely.
//
//   Zdravstvo  → boosted in elderly-heavy občine (65+ share above threshold)
//   Izobraževanje → boosted in kid-heavy občine (0-14 share above threshold)
//
// National ranges: el65 ≈ 0.16-0.39 (mean 0.23), kids ≈ 0.06-0.20 (mean 0.14).
const ELDERLY_THRESHOLD_ZDRAVSTVO = 0.25;
const KIDS_THRESHOLD_IZOBRAZEVANJE = 0.17;
const ZDRAVSTVO_CAT_INDEX = 2;
const IZOBRAZEVANJE_CAT_INDEX = 1;
// Blue used for any boosted pin (regardless of boost kind). Reads clearly
// on both the yellow demand heatmap and the dark basemap.
const BOOST_COLOR: [number, number, number, number] = [37, 99, 235, 230];

const SLOVENIA_CENTER: [number, number] = [14.99, 46.15];
const INITIAL_ZOOM = 7.5;

/** Below this zoom, render občina polygons instead of H3 hexes. */
const SHOW_OBCINE_FILL_BELOW = 9;

const LJUBLJANA_BBOX = {
  minLat: 45.97,
  maxLat: 46.13,
  minLng: 14.40,
  maxLng: 14.65,
};
const H3_BASE_RES = 10;

type View = "15min" | "investor";
export type Mode = "walk" | "bike";

/** Score JSON shape: {h3, w, b} — walk & bike scores baked together. */
type ScoreCell = { h3: string; w: number; b: number };
/** Pre-baked investor demand row — population included for category-filter recompute. */
type DemandRow = { h3: string; wd: number; bd: number; p: number };
type DemandCell = { h3: string; walkDemand: number; bikeDemand: number };
type DemandThresholds = { p50: number; p75: number; p90: number };

function zoomToResolution(zoom: number): number {
  if (zoom < 10) return 6;
  if (zoom < 11) return 7;
  if (zoom < 12) return 8;
  if (zoom < 13.5) return 9;
  return 10;
}

function aggregateMean(cells: ScoreCell[], targetRes: number): ScoreCell[] {
  if (targetRes >= H3_BASE_RES) return cells;
  const groups = new Map<string, { ws: number; bs: number; n: number }>();
  for (const c of cells) {
    const parent = h3.cellToParent(c.h3, targetRes);
    const g = groups.get(parent);
    if (g) {
      g.ws += c.w;
      g.bs += c.b;
      g.n += 1;
    } else {
      groups.set(parent, { ws: c.w, bs: c.b, n: 1 });
    }
  }
  const out: ScoreCell[] = [];
  groups.forEach((g, hex) => out.push({ h3: hex, w: g.ws / g.n, b: g.bs / g.n }));
  return out;
}

function aggregateDemand(cells: DemandCell[], targetRes: number): DemandCell[] {
  if (targetRes >= H3_BASE_RES) return cells;
  const groups = new Map<string, { wd: number; bd: number; n: number }>();
  for (const c of cells) {
    const parent = h3.cellToParent(c.h3, targetRes);
    const g = groups.get(parent);
    if (g) { g.wd += c.walkDemand; g.bd += c.bikeDemand; g.n++; }
    else groups.set(parent, { wd: c.walkDemand, bd: c.bikeDemand, n: 1 });
  }
  const out: DemandCell[] = [];
  groups.forEach((g, hex) => out.push({ h3: hex, walkDemand: g.wd / g.n, bikeDemand: g.bd / g.n }));
  return out;
}

type Rgba = [number, number, number, number];

// Pale parchment for cells that exist inside Slovenia but have zero Kontur
// population — forests, ridges, lakes. Distinct from data colors (no green /
// red / purple) and not gray (gray is reserved for the upcoming protected-
// zone overlay). Alpha 150 keeps the basemap legible underneath.
const UNPOP_COLOR: Rgba = [212, 207, 188, 150];

// Viridis-style 4-step sequential — distinct hue AND luminance per step so it
// reads for color-blind users and at a glance. Alpha 170 (~67 %) gives strong
// data presence without fully hiding the Positron basemap underneath.
function colorForDemand(demand: number, t: DemandThresholds): Rgba {
  if (demand >= t.p90) return [253, 231, 37, 170];   // bright yellow — visok
  if (demand >= t.p75) return [53, 183, 121, 170];   // green — srednji
  if (demand >= t.p50) return [49, 104, 142, 170];   // teal-blue — nizek
  return [68, 1, 84, 170];                            // dark purple — zanemarljiv
}

function colorForScore(score: number): Rgba {
  if (score >= 6) return [16, 185, 129, 128];
  if (score >= 4) return [234, 179, 8, 128];
  if (score >= 2) return [249, 115, 22, 128];
  return [239, 68, 68, 128];
}

type AnimatedPath = { waypoints: [number, number][]; timestamps: number[]; duration: number };

// Equirectangular distance approximation, fine at Slovenia's latitudes for
// the short walking/biking paths we deal with (< 5 km). 111,320 m per
// degree of latitude is the standard constant.
function approxMeters(a: [number, number], b: [number, number]): number {
  const latRad = (a[1] * Math.PI) / 180;
  const dLat = (a[1] - b[1]) * 111_320;
  const dLng = (a[0] - b[0]) * 111_320 * Math.cos(latRad);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

// 2.5 ms per meter, capped at 2 s — the user's stated ceiling. Closer
// amenities animate faster; anything past ~800 m hits the cap.
const MS_PER_METER = 2.5;
const MAX_ANIM_MS = 500;

function buildAnimatedPaths(paths: RoutePath[]): { paths: AnimatedPath[]; maxDuration: number } {
  const out: AnimatedPath[] = [];
  let maxDuration = 0;
  for (const p of paths) {
    if (p.shape.length < 2) continue;
    const cum: number[] = [0];
    let total = 0;
    for (let i = 1; i < p.shape.length; i++) {
      total += approxMeters(p.shape[i - 1], p.shape[i]);
      cum.push(total);
    }
    const duration = total === 0 ? 0 : Math.min(MAX_ANIM_MS, total * MS_PER_METER);
    const timestamps = cum.map((d) => (total === 0 ? 0 : (d / total) * duration));
    out.push({ waypoints: p.shape, timestamps, duration });
    if (duration > maxDuration) maxDuration = duration;
  }
  return { paths: out, maxDuration };
}

function generateDummyCells(): ScoreCell[] {
  const polygon: Array<[number, number]> = [
    [LJUBLJANA_BBOX.minLat, LJUBLJANA_BBOX.minLng],
    [LJUBLJANA_BBOX.maxLat, LJUBLJANA_BBOX.minLng],
    [LJUBLJANA_BBOX.maxLat, LJUBLJANA_BBOX.maxLng],
    [LJUBLJANA_BBOX.minLat, LJUBLJANA_BBOX.maxLng],
  ];
  const cells = h3.polygonToCells(polygon, H3_BASE_RES);
  return cells.map((c) => {
    const r = Math.floor(Math.random() * 9);
    return { h3: c, w: r, b: r };
  });
}

type ObcinaProps = {
  OB_UIME?: string;
  POV_KM2?: number;
  walk_mean?: number;
  bike_mean?: number;
  /** Legacy alias from the old single-mode bake. */
  mean_score?: number;
  population?: number;
  n_cells?: number;
  /** Per-category share (0–1) of population without 15-min access, baked by
   *  `backend/etl/03_score_cells.py:aggregate_obcine`. Optional so the
   *  frontend gracefully handles older obcine_scored.geojson outputs. */
  walk_missing?: Record<string, number>;
  bike_missing?: Record<string, number>;
};

// ---------- Permalink (G4) ----------
type ViewState = { lng: number; lat: number; zoom: number; h3id: string | null };

function readHash(): Partial<ViewState> {
  if (typeof window === "undefined") return {};
  const h = window.location.hash.replace(/^#/, "");
  if (!h) return {};
  const params = new URLSearchParams(h);
  const lng = parseFloat(params.get("lng") || "");
  const lat = parseFloat(params.get("lat") || "");
  const zoom = parseFloat(params.get("z") || "");
  const h3id = params.get("h3");
  return {
    lng: Number.isFinite(lng) ? lng : undefined,
    lat: Number.isFinite(lat) ? lat : undefined,
    zoom: Number.isFinite(zoom) ? zoom : undefined,
    h3id: h3id || null,
  };
}

function writeHash(v: ViewState): void {
  const params = new URLSearchParams();
  params.set("lng", v.lng.toFixed(4));
  params.set("lat", v.lat.toFixed(4));
  params.set("z", v.zoom.toFixed(2));
  if (v.h3id) params.set("h3", v.h3id);
  const next = `#${params.toString()}`;
  if (next !== window.location.hash) {
    window.history.replaceState(null, "", next);
  }
}

export default function SloveniaMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);

  const selectedH3Ref = useRef<string | null>(null);
  const [view, setView] = useState<View>("15min");
  const [cells, setCells] = useState<ScoreCell[]>([]);
  const [cellsLoading, setCellsLoading] = useState(true);
  const [cellsError, setCellsError] = useState<string | null>(null);
  const [demandCells, setDemandCells] = useState<DemandRow[]>([]);
  const [demandLoading, setDemandLoading] = useState(false);
  const [demandError, setDemandError] = useState<string | null>(null);
  // Res-6 H3 cells covering the current map viewport. Refreshed on `moveend`
  // (not on every zoom frame). `null` until the first moveend fires — the
  // visible* useMemos fall through to the full source array in that case so
  // the initial paint matches the pre-culling behavior.
  const [viewportBuckets, setViewportBuckets] = useState<Set<string> | null>(null);
  // Coarse spatial index: each source array bucketed by its res-6 H3 parent.
  // Lets the viewport-cull step pull "all cells in these N r6 buckets" in
  // O(N) instead of scanning the full ~1M array on every pan. Built lazily by
  // useEffects further down once the source arrays land.
  const [cellsByR6, setCellsByR6] = useState<Map<string, ScoreCell[]>>(new Map());
  const [demandByR6, setDemandByR6] = useState<Map<string, DemandCell[]>>(new Map());
  const [unpopByR6, setUnpopByR6] = useState<Map<string, string[]>>(new Map());
  // Pre-aggregated score / demand caches at coarse resolutions (6 and 7).
  // At zoom 9–11 the viewport covers most of Slovenia, so the viewport-cull
  // pipeline still feeds aggregateMean ~800K cells per pan and chokes the
  // main thread. Caching the full-Slovenia aggregation at the two coarse
  // resolutions where the output is tiny (~700 hexes at r6, ~5K at r7) lets
  // us bypass re-aggregation entirely in that zoom band. Built lazily in a
  // deferred effect so initial paint isn't blocked.
  const [scoresAggCache, setScoresAggCache] = useState<Map<number, ScoreCell[]>>(new Map());
  const [demandAggCache, setDemandAggCache] = useState<Map<number, DemandCell[]>>(new Map());
  // Cached obcine GeoJSON — used client-side to synthesize the H3 cells over
  // unpopulated parts of Slovenia. Browser HTTP cache deduplicates with the
  // deck.gl GeoJsonLayer fetch.
  const [obcineFC, setObcineFC] = useState<GeoJSON.FeatureCollection | null>(null);
  // Protected-area polygons kept in memory (separately from the deck.gl
  // `data: PROTECTED_URL` fetch) so the investor-view suggestion-pin filter
  // can run a point-in-polygon over them. Browser HTTP cache deduplicates
  // with the GeoJsonLayer request — same URL.
  const [protectedFC, setProtectedFC] = useState<GeoJSON.FeatureCollection | null>(null);
  const [zoom, setZoom] = useState<number>(INITIAL_ZOOM);
  const [usingDummy, setUsingDummy] = useState<boolean>(false);
  const [selectedH3, setSelectedH3] = useState<string | null>(null);
  // Občina-info card state: set on a click of the občina fill at low zoom,
  // cleared by its own close button or by selecting a hex.
  const [selectedObcina, setSelectedObcina] = useState<ObcinaInfo | null>(null);
  const [isoFeature, setIsoFeature] = useState<GeoJSON.Feature | null>(null);
  const [routeSet, setRouteSet] = useState<RouteSet | null>(null);
  const [amenityDots, setAmenityDots] = useState<AmenityForPoint[] | null>(null);
  const [hoveredAmenity, setHoveredAmenity] = useState<AmenityForPoint | null>(null);
  const [provenanceOpen, setProvenanceOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("walk");
  // When set, the Scorecard routes from this exact point instead of the cell
  // centroid. fromAddress distinguishes address-bar picks (which should clear
  // the input on Scorecard close) from ChatBox-driven picks.
  const [originLngLat, setOriginLngLat] = useState<[number, number] | null>(null);
  const [originFromAddress, setOriginFromAddress] = useState(false);
  const addressSearchRef = useRef<AddressSearchHandle | null>(null);
  const [theme] = useTheme();
  const [legendOpen, setLegendOpen] = useState(false);
  // Path-spread animation. currentTime advances via requestAnimationFrame
  // from 0 → maxDuration each time a new routeSet lands. TripsLayer fades
  // segments older than `currentTime - trailLength`; with trailLength = 1e9
  // every revealed segment stays visible permanently.
  const [animTime, setAnimTime] = useState(0);
  // Hex fade progress driven by routesActive. 0 = no fade, 1 = full fade.
  // We animate this in JS via rAF (rather than deck.gl's per-attribute
  // `transitions` config) because deck.gl interpolates per BUFFER INDEX —
  // when zoom or pan changes the data array, the same index slot holds a
  // different cell before/after, and deck.gl animates between their colors,
  // producing the orange↔green flash the user reported. Driving the fade
  // through state keeps each per-frame snapshot internally consistent.
  const [fadeProgress, setFadeProgress] = useState(0);
  const fadeProgressRef = useRef(0);
  // Investor view state — per-category scores, the active category filter,
  // and the precomputed building-suggestion pins shown on top of the demand
  // heatmap when a category is active.
  const [catScores, setCatScores] = useState<Map<string, number[]>>(new Map());
  const [investorCat, setInvestorCat] = useState<number | null>(null);
  const [suggestionPins, setSuggestionPins] = useState<Suggestion[]>([]);
  const [buildingSuggestions, setBuildingSuggestions] = useState<
    Record<string, { lat: number; lng: number; source: string; demand: number; members: number; s?: number }[]>
  >({});
  // Sifra → {el65, kids}. Loaded lazily on first switch into investor view.
  // Used to mark category-2 (Zdravstvo) and category-1 (Izobraževanje) pins
  // whose občina exceeds the corresponding threshold. Empty Map until the
  // fetch resolves; in that window no pins are marked, which gracefully
  // degrades to the pre-feature behavior.
  const [demographicsBySifra, setDemographicsBySifra] = useState<
    Map<number, { el65: number; kids: number }>
  >(new Map());
  // AI search results: up to 5 cells returned by /api/llm-search.
  // Source of truth for the ai-search-pins ScatterplotLayer.
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [hoveredResultH3, setHoveredResultH3] = useState<string | null>(null);

  // Fetch real scores; fall back to dummy if not yet baked.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(SCORES_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: ScoreCell[] = await res.json();
        if (!cancelled) {
          setCells(data);
          setUsingDummy(false);
          setCellsError(null);
          // eslint-disable-next-line no-console
          console.log(`Loaded ${data.length.toLocaleString()} real cells`);
        }
      } catch (err) {
        if (!cancelled) {
          // eslint-disable-next-line no-console
          console.warn("Falling back to dummy hexes:", err);
          setCells(generateDummyCells());
          setUsingDummy(true);
          setCellsError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setCellsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // One-shot fetch of obcine polygons for client-side unpopulated-cell
  // synthesis. Browser HTTP cache serves the same URL deck.gl is already
  // requesting, so this is effectively free network-wise.
  useEffect(() => {
    let cancelled = false;
    fetch(OBCINE_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((fc) => { if (!cancelled && fc) setObcineFC(fc as GeoJSON.FeatureCollection); })
      .catch(() => { /* unpop layer just stays empty — non-fatal */ });
    return () => { cancelled = true; };
  }, []);

  // Same one-shot fetch for protected areas. Used by the investor-pin filter
  // to drop OPN (yellow) new-construction proposals that land inside a
  // protected polygon. FRO (red) pins stay regardless — they mark degraded
  // areas slated for revitalization, which is appropriate even in parks.
  useEffect(() => {
    let cancelled = false;
    fetch(PROTECTED_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((fc) => { if (!cancelled && fc) setProtectedFC(fc as GeoJSON.FeatureCollection); })
      .catch(() => { /* filter just no-ops if the fetch fails — non-fatal */ });
    return () => { cancelled = true; };
  }, []);

  // Lazy-load pre-baked investor demand on first switch. Replaces the old
  // heavy browser-side compute (populatedRes9 loops + demand formula) with a
  // simple JSON fetch + cheap .map(). Deps deliberately omit demandLoading.
  useEffect(() => {
    if (view !== "investor" || demandCells.length > 0) return;
    let cancelled = false;
    setDemandLoading(true);
    setDemandError(null);
    fetch(DEMAND_URL)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText || ""}`.trim());
        return r.json();
      })
      .then((data: unknown) => {
        if (cancelled) return;
        if (!Array.isArray(data)) throw new Error("Neveljaven format podatkov");
        setDemandCells(data as DemandRow[]);
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("Demand fetch failed:", err);
        setDemandError(msg);
      })
      .finally(() => { if (!cancelled) setDemandLoading(false); });
    return () => { cancelled = true; };
  }, [view, demandCells.length]);

  // Lazy-load per-category scores when investor category filter is first used.
  useEffect(() => {
    if (view !== "investor" || investorCat === null || catScores.size > 0) return;
    fetch("/data/cell_cat_scores.json")
      .then((r) => r.json())
      .then((data: { h3: string; c: number[] }[]) => {
        setCatScores(new Map(data.map((d) => [d.h3, d.c])));
      })
      .catch((err) => console.warn("cat_scores fetch failed:", err));
  }, [view, investorCat, catScores.size]);

  // Initialize map once. Restore from URL hash if present.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const restored = readHash();
    const center: [number, number] =
      restored.lng !== undefined && restored.lat !== undefined
        ? [restored.lng, restored.lat]
        : SLOVENIA_CENTER;
    const zoomInit = restored.zoom ?? INITIAL_ZOOM;
    if (restored.h3id) setSelectedH3(restored.h3id);

    const initialStyle = document.documentElement.getAttribute("data-theme") === "dark"
      ? BASEMAP_DARK
      : BASEMAP_LIGHT;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: initialStyle,
      center,
      zoom: zoomInit,
      // Lock the map flat — no tilt, no compass-spin. The data is 2D scoring;
      // there's no 3D building data to look at, and tilt only invites users
      // into a state where the H3 hexes shear and labels stop reading.
      maxPitch: 0,
      pitchWithRotate: false,
      touchPitch: false,
      dragRotate: false,
      // No bottom-right attribution chip — sources are credited in the
      // IzvorPodatkov modal opened from the bottom-left "Od kod podatki?" link.
      attributionControl: false,
    });
    mapRef.current = map;

    const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
    overlayRef.current = overlay;
    map.addControl(overlay as unknown as maplibregl.IControl);

    // Strip 3D + dim POIs every time the style finishes loading. `styledata`
    // fires on the initial style AND on every setStyle thereafter — covers
    // the theme-swap path without a second listener.
    map.on("styledata", () => harmonizeBasemap(map));

    const sync = () => {
      const c = map.getCenter();
      const z = map.getZoom();
      setZoom(z);
      writeHash({ lng: c.lng, lat: c.lat, zoom: z, h3id: selectedH3Ref.current });
    };
    // Viewport-bucket refresh — only on moveend so we don't recompute during
    // every frame of a zoom animation. maplibre fires moveend after both
    // panning and zooming finishes, so this single hook covers both.
    const syncViewportBuckets = () => {
      const b = map.getBounds();
      const cLat = (b.getSouth() + b.getNorth()) / 2;
      const cLng = (b.getWest() + b.getEast()) / 2;
      const dLat = b.getNorth() - cLat;   // half-height of the visible viewport
      const dLng = b.getEast() - cLng;    // half-width  of the visible viewport
      // Sample the bucket set over a 2×-linear region around the viewport
      // center — pans that outrun the next moveend still find their cells
      // already in `viewportBuckets`. Cost is one polygonToCells call;
      // we're only filtering at hex zoom anyway (the obcina-fill path skips
      // the visible* useMemos entirely).
      const ring: [number, number][] = [
        [cLat - 2 * dLat, cLng - 2 * dLng],
        [cLat - 2 * dLat, cLng + 2 * dLng],
        [cLat + 2 * dLat, cLng + 2 * dLng],
        [cLat + 2 * dLat, cLng - 2 * dLng],
        [cLat - 2 * dLat, cLng - 2 * dLng],
      ];
      const buckets = new Set(h3.polygonToCells(ring, 6));
      // Critical safety net at zoom ≥ 13: a single r6 cell is ~12 km², which
      // is larger than the (already 2×-expanded) viewport — no r6 *center*
      // sits inside the ring and polygonToCells returns []. Always seed the
      // bucket set with the r6 cell under the viewport center plus its
      // 1-ring (7 cells, ~84 km² of coverage) so visibleCells is never empty
      // while the user is over Slovenia.
      const centerR6 = h3.latLngToCell(cLat, cLng, 6);
      for (const c of h3.gridDisk(centerR6, 1)) buckets.add(c);
      setViewportBuckets(buckets);
    };
    map.on("zoom", sync);
    map.on("moveend", sync);
    map.on("moveend", syncViewportBuckets);
    // Prime once so we don't have to wait for the first user interaction.
    syncViewportBuckets();

    return () => {
      map.off("zoom", sync);
      map.off("moveend", sync);
      map.off("moveend", syncViewportBuckets);
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror selectedH3 into both the ref (for the closure-captured sync
  // handler) and the URL hash. Also enforces mutual exclusion with the
  // občina-info card — selecting a hex closes any open občina card,
  // regardless of which code path set selectedH3 (map click, hash restore,
  // address search, chat).
  useEffect(() => {
    selectedH3Ref.current = selectedH3;
    if (selectedH3) setSelectedObcina(null);
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    writeHash({ lng: c.lng, lat: c.lat, zoom: map.getZoom(), h3id: selectedH3 });
  }, [selectedH3]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;
    if (theme === "dark") {
      loadDarkBasemap()
        .then((spec) => { if (!cancelled) map.setStyle(spec as maplibregl.StyleSpecification); })
        .catch(() => { if (!cancelled) map.setStyle(BASEMAP_DARK); });
    } else {
      map.setStyle(BASEMAP_LIGHT);
    }
    return () => { cancelled = true; };
  }, [theme]);

  const showObcineFill = zoom < SHOW_OBCINE_FILL_BELOW;
  const currentRes = zoomToResolution(zoom);

  // Viewport-culled subset of `cells` — pulled from cellsByR6 by the set of
  // res-6 parents currently in view. Falls through to the full `cells` array
  // when the bucket map isn't ready yet or before the first `moveend` so the
  // initial paint matches the pre-culling behavior.
  const visibleCells = useMemo<ScoreCell[]>(() => {
    if (showObcineFill) return [];
    if (cellsByR6.size === 0 || !viewportBuckets) return cells;
    const out: ScoreCell[] = [];
    for (const p6 of viewportBuckets) {
      const bucket = cellsByR6.get(p6);
      if (bucket) for (const c of bucket) out.push(c);
    }
    return out;
  }, [cells, cellsByR6, viewportBuckets, showObcineFill]);

  const aggregatedScores = useMemo(() => {
    if (showObcineFill) return [];
    // Coarse-zoom fast path: serve the pre-aggregated full-Slovenia bake at
    // r6 / r7. Skips the per-pan re-aggregation over hundreds of thousands
    // of viewport-cull cells (which is what made zoom 9.25–10 feel laggy).
    const cached = scoresAggCache.get(currentRes);
    if (cached) return cached;
    return aggregateMean(visibleCells, currentRes);
  }, [scoresAggCache, visibleCells, currentRes, showObcineFill]);

  // Synthesize the H3 cells covering Slovenia's unpopulated geography
  // (forests / ridges / lakes — areas the Kontur population grid skips).
  //
  // This compute is heavy (~212 občina polygons × polygonToCells at res 9 plus
  // cellToChildren over the unpopulated set ⇒ several million h3 ops total).
  // Running it inside a useMemo means it executes synchronously during render
  // and blocks the main thread for multiple seconds the first time `pops`
  // lands. We move it to a useEffect with setTimeout scheduling so the
  // "Nalagam podatke …" banner paints first; `unpopComputing` is the gate.
  const [unpopCells, setUnpopCells] = useState<string[]>([]);
  const [unpopComputing, setUnpopComputing] = useState(false);

  useEffect(() => {
    if (!obcineFC || cells.length === 0) {
      setUnpopCells([]);
      setUnpopComputing(false);
      return;
    }
    let cancelled = false;
    setUnpopComputing(true);
    // setTimeout (macrotask) guarantees the banner paints before this blocks.
    // Starts at app load (no longer gated on investor switch or pops fetch) so
    // the heavy polygonToCells work runs in the background while the user
    // browses the default view — likely done before they ever click "Investitor".
    const id = setTimeout(() => {
      if (cancelled) return;
      const populatedRes10 = new Set(cells.map((c) => c.h3));
      // Derive populated res-9 from cells directly — avoids dependency on pops.
      const populatedRes9 = new Set(cells.map((c) => h3.cellToParent(c.h3, 9)));
      const sloveniaRes9 = new Set<string>();
      for (const f of obcineFC.features) {
        const geom = f.geometry;
        const polys: number[][][][] =
          geom.type === "Polygon" ? [geom.coordinates] :
          geom.type === "MultiPolygon" ? geom.coordinates :
          [];
        for (const poly of polys) {
          const outer = poly[0].map(([lng, lat]) => [lat, lng] as [number, number]);
          for (const c of h3.polygonToCells(outer, 9)) sloveniaRes9.add(c);
        }
      }
      const out: string[] = [];
      for (const p9 of sloveniaRes9) {
        if (populatedRes9.has(p9)) continue;
        for (const c of h3.cellToChildren(p9, H3_BASE_RES)) {
          if (!populatedRes10.has(c)) out.push(c);
        }
      }
      if (!cancelled) {
        setUnpopCells(out);
        setUnpopComputing(false);
      }
    }, 50);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [obcineFC, cells]);

  // Bucket builders for the coarse spatial index. State declarations live
  // higher up (next to the other dataset state) so they're available to the
  // consumer useMemos defined before this point.
  useEffect(() => {
    if (cells.length === 0) return;
    let cancelled = false;
    const id = setTimeout(() => {
      if (cancelled) return;
      const m = new Map<string, ScoreCell[]>();
      for (const c of cells) {
        const p6 = h3.cellToParent(c.h3, 6);
        const bucket = m.get(p6);
        if (bucket) bucket.push(c);
        else m.set(p6, [c]);
      }
      if (!cancelled) setCellsByR6(m);
    }, 50);
    return () => { cancelled = true; clearTimeout(id); };
  }, [cells]);

  // Build the coarse-zoom score-aggregation cache once cells land. Same
  // setTimeout pattern as the bucket builders so the banner paints first.
  // Resolutions 6 (~700 hexes) and 7 (~5K hexes) cover zoom 9–11; output
  // arrays are tiny and Slovenia-wide so panning at coarse zoom doesn't
  // need to re-aggregate.
  useEffect(() => {
    if (cells.length === 0) return;
    let cancelled = false;
    const id = setTimeout(() => {
      if (cancelled) return;
      const m = new Map<number, ScoreCell[]>();
      for (const r of [6, 7]) m.set(r, aggregateMean(cells, r));
      if (!cancelled) setScoresAggCache(m);
    }, 80);
    return () => { cancelled = true; clearTimeout(id); };
  }, [cells]);

  useEffect(() => {
    if (unpopCells.length === 0) return;
    let cancelled = false;
    const id = setTimeout(() => {
      if (cancelled) return;
      const m = new Map<string, string[]>();
      for (const h of unpopCells) {
        const p6 = h3.cellToParent(h, 6);
        const bucket = m.get(p6);
        if (bucket) bucket.push(h);
        else m.set(p6, [h]);
      }
      if (!cancelled) setUnpopByR6(m);
    }, 50);
    return () => { cancelled = true; clearTimeout(id); };
  }, [unpopCells]);

  // Aggregate unpopulated cells to currentRes so they match the on-screen hex
  // size of the score / investor data they sit underneath. At res-10 itself
  // it's a no-op; below, we dedupe by parent so each rendered hex appears once.
  // Viewport-culled subset of `unpopCells`. Same fall-through rule as
  // `visibleCells`. See comment there.
  const visibleUnpop = useMemo<string[]>(() => {
    if (showObcineFill) return [];
    if (unpopByR6.size === 0 || !viewportBuckets) return unpopCells;
    const out: string[] = [];
    for (const p6 of viewportBuckets) {
      const bucket = unpopByR6.get(p6);
      if (bucket) for (const c of bucket) out.push(c);
    }
    return out;
  }, [unpopCells, unpopByR6, viewportBuckets, showObcineFill]);

  const aggregatedUnpop = useMemo<string[]>(() => {
    if (showObcineFill) return [];
    if (currentRes >= H3_BASE_RES) return visibleUnpop;
    const parents = new Set<string>();
    for (const c of visibleUnpop) parents.add(h3.cellToParent(c, currentRes));
    return Array.from(parents);
  }, [visibleUnpop, currentRes, showObcineFill]);

  const animatedPaths = useMemo(
    () => (routeSet && routeSet.paths.length > 0 ? buildAnimatedPaths(routeSet.paths) : null),
    [routeSet],
  );

  // Run the animation each time a fresh routeSet → animatedPaths lands.
  // Stops cleanly: rAF cancels when elapsed exceeds maxDuration, and
  // animTime sticks at maxDuration so the trail stays fully painted.
  useEffect(() => {
    if (!animatedPaths || animatedPaths.maxDuration === 0) {
      setAnimTime(0);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      setAnimTime(Math.min(elapsed, animatedPaths.maxDuration));
      if (elapsed < animatedPaths.maxDuration) raf = requestAnimationFrame(tick);
    };
    setAnimTime(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animatedPaths]);

  // Hex fade gate. Lifted out of the layer-build effect so the rAF driver
  // below can read it.
  const routesActive = useMemo(
    () => isoFeature !== null || (routeSet !== null && routeSet.paths.length > 0),
    [isoFeature, routeSet],
  );

  // Občina under the selected hex's centroid. Brute-force point-in-polygon
  // against the 212 cached občine — under 1 ms per click — so we can show
  // the municipality name in the Scorecard header without a server roundtrip.
  const cellObcinaName = useMemo<string | null>(() => {
    if (!selectedH3 || !obcineFC) return null;
    const [lat, lng] = h3.cellToLatLng(selectedH3);
    for (const f of obcineFC.features) {
      if (pointInFeature(lng, lat, f)) {
        return ((f.properties as ObcinaProps | null)?.OB_UIME) ?? null;
      }
    }
    return null;
  }, [selectedH3, obcineFC]);

  // Drive fadeProgress 0↔1 over 500 ms whenever routesActive flips. Each frame
  // of the animation forces the layer-build effect to re-run (fadeProgress is
  // a dep), and the H3HexagonLayer's getFillColor reads the new value via
  // updateTriggers — yielding a smooth fade without using deck.gl's per-index
  // attribute interpolation (which is what caused the zoom/pan flash).
  useEffect(() => {
    const target = routesActive ? 1 : 0;
    const from = fadeProgressRef.current;
    if (from === target) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 500);
      const next = from + (target - from) * t;
      fadeProgressRef.current = next;
      setFadeProgress(next);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [routesActive]);

  // Keyed by h3 for O(1) child lookup in investor onClick.
  const cellsMap = useMemo(() => new Map(cells.map((c) => [c.h3, c])), [cells]);

  const groupedPins = useMemo<GroupedPin[]>(() => {
    // Drop OPN ("opn", yellow) suggestions whose point falls inside a
    // protected polygon — new construction proposals don't apply in parks.
    // FRO ("fro", red, degraded land slated for revitalization) is allowed
    // anywhere, including inside protected areas. If the protected GeoJSON
    // hasn't loaded yet we just skip the filter (non-fatal).
    const inProtected = (lng: number, lat: number) => {
      if (!protectedFC) return false;
      for (const f of protectedFC.features) {
        if (pointInFeature(lng, lat, f)) return true;
      }
      return false;
    };
    const map = new Map<string, GroupedPin>();
    for (const s of suggestionPins) {
      if (s.source === "opn" && inProtected(s.lng, s.lat)) continue;
      const key = `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`;
      const existing = map.get(key);
      if (existing) {
        existing.items.push(s);
        // All items in a group share lat/lng → same občina → same kind, so
        // the first item's value already represents the group.
        if (!existing.boostKind && s.boostKind) existing.boostKind = s.boostKind;
      } else {
        map.set(key, {
          lat: s.lat,
          lng: s.lng,
          zoneCode: s.zoneCode,
          zoneDesc: s.zoneDesc,
          items: [s],
          boostKind: s.boostKind,
        });
      }
    }
    return Array.from(map.values());
  }, [suggestionPins, protectedFC]);

  // Derive investorCells from pre-baked demand. Base case (no category filter)
  // is instant — wd/bd already computed. Category filter requires h3.cellToParent
  // per cell (~2s); defer with setTimeout so the banner paints first.
  const [investorCells, setInvestorCells] = useState<DemandCell[]>([]);
  const [investorComputing, setInvestorComputing] = useState(false);

  useEffect(() => {
    if (!Array.isArray(demandCells) || demandCells.length === 0) { setInvestorCells([]); return; }

    if (investorCat === null || catScores.size === 0) {
      // Pre-baked values, no h3 ops — effectively instant.
      setInvestorCells(
        demandCells.map((d) => ({ h3: d.h3, walkDemand: d.wd, bikeDemand: d.bd })),
      );
      return;
    }

    // Category filter: cellToParent per cell → defer so banner shows first.
    let cancelled = false;
    setInvestorComputing(true);
    const id = setTimeout(() => {
      if (cancelled) return;
      const out: DemandCell[] = demandCells.map((d) => {
        const p9 = h3.cellToParent(d.h3, 9);
        const catArr = catScores.get(p9);
        if (!catArr) return { h3: d.h3, walkDemand: 0, bikeDemand: 0 };
        const present = catArr[investorCat];
        const demand = present >= 1 ? 0 : d.p * (1 - present);
        return { h3: d.h3, walkDemand: demand, bikeDemand: demand };
      });
      if (!cancelled) { setInvestorCells(out); setInvestorComputing(false); }
    }, 50);
    return () => { cancelled = true; clearTimeout(id); };
  }, [demandCells, investorCat, catScores]);

  // Bucket the investor-demand cells by res-6 parent — companion to cellsByR6
  // / unpopByR6 above. Rebuilds whenever investorCells changes (category
  // toggle re-runs the upstream effect, which is why we key on the post-map
  // DemandCell[] rather than the raw DemandRow[]).
  useEffect(() => {
    if (investorCells.length === 0) return;
    let cancelled = false;
    const id = setTimeout(() => {
      if (cancelled) return;
      const m = new Map<string, DemandCell[]>();
      for (const d of investorCells) {
        const p6 = h3.cellToParent(d.h3, 6);
        const bucket = m.get(p6);
        if (bucket) bucket.push(d);
        else m.set(p6, [d]);
      }
      if (!cancelled) setDemandByR6(m);
    }, 50);
    return () => { cancelled = true; clearTimeout(id); };
  }, [investorCells]);

  // Coarse-zoom demand aggregation cache — analogous to `scoresAggCache`.
  // Rebuilds whenever investorCells changes (category toggle or fresh load).
  useEffect(() => {
    if (investorCells.length === 0) return;
    let cancelled = false;
    const id = setTimeout(() => {
      if (cancelled) return;
      const m = new Map<number, DemandCell[]>();
      for (const r of [6, 7]) m.set(r, aggregateDemand(investorCells, r));
      if (!cancelled) setDemandAggCache(m);
    }, 80);
    return () => { cancelled = true; clearTimeout(id); };
  }, [investorCells]);

  // Viewport-culled subset of `investorCells`. Same fall-through rule as
  // `visibleCells`. Note: a category toggle resets `investorCells` ~50–500 ms
  // before `demandByR6` rebuilds; during that window the bucket map is stale
  // but the H3 set is unchanged across toggles (only demand values differ),
  // so the visible subset stays correct in shape — hex colors briefly reflect
  // the previous category until the bucket rebuild completes.
  const visibleInvestor = useMemo<DemandCell[]>(() => {
    if (showObcineFill) return [];
    if (demandByR6.size === 0 || !viewportBuckets) return investorCells;
    const out: DemandCell[] = [];
    for (const p6 of viewportBuckets) {
      const bucket = demandByR6.get(p6);
      if (bucket) for (const c of bucket) out.push(c);
    }
    return out;
  }, [investorCells, demandByR6, viewportBuckets, showObcineFill]);

  const aggregatedInvestorCells = useMemo(() => {
    if (showObcineFill) return [];
    // Same coarse-zoom fast path as `aggregatedScores` above.
    const cached = demandAggCache.get(currentRes);
    if (cached) return cached;
    return aggregateDemand(visibleInvestor, currentRes);
  }, [demandAggCache, visibleInvestor, currentRes, showObcineFill]);

  const demandThresholds = useMemo<DemandThresholds>(() => {
    // Anchored on the full `investorCells` set rather than the viewport-culled
    // `aggregatedInvestorCells`, so hex colors don't shift as the user pans.
    // Also makes thresholds zoom-band-independent (the previous version
    // re-aggregated at each `currentRes`, which jittered the percentiles).
    if (investorCells.length === 0) return { p50: 1, p75: 2, p90: 4 };
    // Filter zero-demand cells out of the percentile calc — they're the
    // "zanemarljivo" sink (fully-served zones, etc.) and would otherwise
    // collapse p50 to zero whenever a saturated category is selected,
    // causing every cell to register as `demand >= p50` and paint teal.
    const vals = investorCells
      .map((c) => (mode === "walk" ? c.walkDemand : c.bikeDemand))
      .filter((v) => v > 0)
      .sort((a, b) => a - b);
    const n = vals.length;
    if (n === 0) return { p50: 1, p75: 2, p90: 4 };
    return {
      p50: vals[Math.floor(n * 0.50)],
      p75: vals[Math.floor(n * 0.75)],
      p90: vals[Math.floor(n * 0.90)],
    };
  }, [investorCells, mode]);

  // Lazy-load pre-computed building suggestions once when investor view is opened.
  useEffect(() => {
    if (view !== "investor" || Object.keys(buildingSuggestions).length > 0) return;
    fetch("/data/building_suggestions.json")
      .then((r) => r.json())
      .then(setBuildingSuggestions)
      .catch((err) => console.warn("building_suggestions fetch failed:", err));
  }, [view, buildingSuggestions]);

  // Lazy-load per-občina demographics (sifra → {el65, kids}). Used to mark
  // boost-eligible pins; fetch is unconditional in investor view so toggling
  // categories doesn't introduce a load delay on the second open.
  useEffect(() => {
    if (view !== "investor" || demographicsBySifra.size > 0) return;
    fetch(DEMOGRAPHICS_URL)
      .then((r) => r.json())
      .then((raw: Record<string, { el65: number; kids: number; name?: string }>) => {
        const m = new Map<number, { el65: number; kids: number }>();
        for (const [sifra, v] of Object.entries(raw)) {
          m.set(Number(sifra), { el65: v.el65 ?? 0, kids: v.kids ?? 0 });
        }
        setDemographicsBySifra(m);
      })
      .catch((err) => console.warn("obcine_demographics fetch failed:", err));
  }, [view, demographicsBySifra]);

  // Show pins for the active category filter — instant, no network calls.
  // For Zdravstvo and Izobraževanje, attach `boostKind` to pins whose občina
  // crosses the matching threshold; the ScatterplotLayer + tooltip key off
  // this flag to paint blue and explain the marking.
  useEffect(() => {
    if (view !== "investor" || investorCat === null) {
      setSuggestionPins([]);
      return;
    }
    const raw = buildingSuggestions[String(investorCat)] ?? [];
    setSuggestionPins(
      raw.map((s) => {
        const demo = s.s !== undefined ? demographicsBySifra.get(s.s) : undefined;
        let boostKind: BoostKind | undefined;
        if (demo) {
          if (
            investorCat === ZDRAVSTVO_CAT_INDEX &&
            demo.el65 > ELDERLY_THRESHOLD_ZDRAVSTVO
          ) {
            boostKind = "elderly";
          } else if (
            investorCat === IZOBRAZEVANJE_CAT_INDEX &&
            demo.kids > KIDS_THRESHOLD_IZOBRAZEVANJE
          ) {
            boostKind = "kids";
          }
        }
        return {
          categoryIndex: investorCat,
          lat: s.lat,
          lng: s.lng,
          zoneCode: s.source === "fro" ? "FRO" : "OPN",
          zoneDesc: s.source === "fro" ? "Degradirano območje" : "Predlagana lokacija",
          distanceM: s.demand,   // repurpose field to carry demand for tooltip
          source: (s.source === "fro" ? "fro" : "opn") as "fro" | "opn",
          members: s.members,
          boostKind,
        };
      }),
    );
  }, [view, investorCat, buildingSuggestions, demographicsBySifra]);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    // In dark mode, pull all hex fill RGB values down to 65 % so they sit
    // naturally on the darkened basemap without washing it out.
    const hexDark = theme === "dark";
    const dk = (c: Rgba): Rgba =>
      hexDark ? [Math.round(c[0] * 0.65), Math.round(c[1] * 0.65), Math.round(c[2] * 0.65), c[3]] : c;

    // When the user has triggered a route or isochrone overlay, fade hex
    // fills so the new overlay reads. Non-selected hexes drop alpha by 0.30
    // (barely visible); the selected hex drops only 0.15 so it stays the
    // anchor of the visible area. fadeProgress (0..1) is driven by a rAF
    // effect above; multiplying through it gives a smooth 500 ms ease without
    // relying on deck.gl's `transitions` (which interpolates per buffer
    // index and flashes when the data array re-orders on zoom/pan).
    const selectedAtCurrentRes = selectedH3
      ? h3.cellToParent(selectedH3, currentRes)
      : null;
    const fade = (c: Rgba, delta: number): Rgba =>
      delta === 0 ? c : [c[0], c[1], c[2], Math.max(0, Math.round(c[3] - delta * 255))];
    const fadeDelta = (h3id: string): number =>
      (h3id === selectedAtCurrentRes ? 0.15 : 0.30) * fadeProgress;
    // Selection feedback for the občina-fill / investor-obcine layers: the
    // clicked municipality gets its alpha bumped by 0.15 so it pops out from
    // its neighbors. Identifier is OB_UIME (Slovenian občine all have unique
    // names; cheaper than threading OB_ID through ObcinaProps).
    const selectedObcinaName = selectedObcina?.OB_UIME ?? null;
    const bumpAlpha = (c: Rgba, delta: number): Rgba =>
      [c[0], c[1], c[2], Math.min(255, Math.max(0, Math.round(c[3] + delta * 255)))];

    const layers: Layer[] = [];

    // Unpopulated cells — painted first so they sit beneath all data layers.
    // Only relevant at hex zoom; below `SHOW_OBCINE_FILL_BELOW` the obcina
    // fill already covers Slovenia uniformly.
    if (!showObcineFill && aggregatedUnpop.length > 0) {
      const unpopBase: Rgba = hexDark ? [138, 135, 122, 150] : UNPOP_COLOR;
      layers.push(
        new H3HexagonLayer<string>({
          id: "unpop-hex",
          data: aggregatedUnpop,
          pickable: false,
          stroked: false,
          filled: true,
          extruded: false,
          getHexagon: (d) => d,
          // Unpop cells never match `selectedAtCurrentRes` (selection is over
          // populated cells only), so they always take the full fade.
          getFillColor: (_d: string) => fade(unpopBase, 0.30 * fadeProgress),
          updateTriggers: { getFillColor: [fadeProgress, hexDark] },
        }),
      );
    }

    if (view === "investor") {
      if (showObcineFill) {
        layers.push(
          new GeoJsonLayer<ObcinaProps>({
            id: "investor-obcine",
            data: OBCINE_URL,
            stroked: true,
            filled: true,
            getFillColor: (f) => {
              const p = f.properties ?? {};
              const score = (mode === "bike" ? p.bike_mean : p.walk_mean) ?? p.mean_score ?? 0;
              const nCells = p.n_cells ?? 1;
              const d = (p.population ?? 0) * (1 - score / 8) / nCells;
              const base = dk(colorForDemand(d, demandThresholds));
              return p.OB_UIME && p.OB_UIME === selectedObcinaName ? bumpAlpha(base, 0.15) : base;
            },
            getLineColor: [60, 60, 60, 200],
            lineWidthMinPixels: 1,
            pickable: true,
            onClick: ({ object }) => {
              const props = (object as GeoJSON.Feature<GeoJSON.Geometry, ObcinaProps> | null)?.properties;
              if (!props) return;
              setSelectedH3(null);
              setSelectedObcina(props);
            },
            updateTriggers: { getFillColor: [mode, demandThresholds, hexDark, selectedObcinaName] },
          }),
        );
      } else {
        layers.push(
          new GeoJsonLayer({
            id: "investor-obcine-outline",
            data: OBCINE_URL,
            stroked: true,
            filled: false,
            lineWidthMinPixels: 1,
            getLineColor: [80, 80, 80, 160],
            pickable: false,
          }),
          new H3HexagonLayer<DemandCell>({
            id: "investor-hex",
            data: aggregatedInvestorCells,
            pickable: true,
            stroked: currentRes < H3_BASE_RES,
            filled: true,
            extruded: false,
            getHexagon: (d) => d.h3,
            getFillColor: (d) => fade(
              dk(colorForDemand(mode === "walk" ? d.walkDemand : d.bikeDemand, demandThresholds)),
              fadeDelta(d.h3),
            ),
            getLineColor: [255, 255, 255, 70],
            lineWidthUnits: "pixels",
            getLineWidth: 0.5,
            updateTriggers: {
              getFillColor: [mode, demandThresholds, hexDark, fadeProgress, selectedAtCurrentRes],
            },
            onClick: ({ object }) => {
              if (!object) return;
              if (h3.getResolution(object.h3) >= H3_BASE_RES) {
                setSelectedH3(object.h3);
                return;
              }
              // Show the res-10 child with the lowest walk score — this is what
              // makes the investor hex red, so it's what the user expects to see.
              const children = h3.cellToChildren(object.h3, H3_BASE_RES);
              let worst = children[0];
              let worstScore = cellsMap.get(worst)?.w ?? 8;
              for (const c of children) {
                const s = cellsMap.get(c)?.w ?? 8;
                if (s < worstScore) { worstScore = s; worst = c; }
              }
              setSelectedH3(worst);
            },
          }),
        );

      }
    } else if (showObcineFill) {
      layers.push(
        new GeoJsonLayer<ObcinaProps>({
          id: "obcine-fill",
          data: OBCINE_URL,
          stroked: true,
          filled: true,
          getFillColor: (f) => {
            const p = f.properties ?? {};
            const v = (mode === "bike" ? p.bike_mean : p.walk_mean) ?? p.mean_score ?? 0;
            const base = dk(colorForScore(v));
            return p.OB_UIME && p.OB_UIME === selectedObcinaName ? bumpAlpha(base, 0.15) : base;
          },
          getLineColor: [60, 60, 60, 200],
          lineWidthMinPixels: 1,
          onClick: ({ object }) => {
            const props = (object as GeoJSON.Feature<GeoJSON.Geometry, ObcinaProps> | null)?.properties;
            if (!props) return;
            setSelectedH3(null);
            setSelectedObcina(props);
          },
          pickable: true,
          updateTriggers: { getFillColor: [mode, hexDark, selectedObcinaName] },
        }),
      );
    } else {
      layers.push(
        new GeoJsonLayer({
          id: "obcine-outline",
          data: OBCINE_URL,
          stroked: true,
          filled: false,
          lineWidthMinPixels: 1,
          getLineColor: [80, 80, 80, 160],
          pickable: false,
        }),
        new H3HexagonLayer<ScoreCell>({
          id: "scores",
          data: aggregatedScores,
          pickable: true,
          stroked: true,
          filled: true,
          extruded: false,
          getHexagon: (d) => d.h3,
          getFillColor: (d) => fade(
            dk(colorForScore(mode === "bike" ? d.b : d.w)),
            fadeDelta(d.h3),
          ),
          getLineColor: [255, 255, 255, 70],
          lineWidthUnits: "pixels",
          getLineWidth: 0.5,
          updateTriggers: {
            getFillColor: [aggregatedScores, mode, hexDark, fadeProgress, selectedAtCurrentRes],
          },
          onClick: ({ object }) => {
            if (!object) return;
            const target =
              h3.getResolution(object.h3) >= H3_BASE_RES
                ? object.h3
                : h3.cellToChildren(object.h3, H3_BASE_RES)[0];
            setOriginLngLat(null);
            setOriginFromAddress(false);
            setSelectedH3(target);
          },
        }),
      );

      // Selected-cell highlight: stroke-only outline to complement the
      // gradient mesh without obscuring it. The user can pick the clicked
      // cell out of the map at a glance via the dark 2.5px border.
      // Rendered at the *current aggregated resolution*, not res-10, so it
      // visually matches the surrounding score cells.
      if (selectedH3) {
        const parent = h3.cellToParent(selectedH3, currentRes);
        layers.push(
          new H3HexagonLayer<{ h3: string }>({
            id: "selected-hex",
            data: [{ h3: parent }],
            getHexagon: (d) => d.h3,
            stroked: true,
            filled: false,
            extruded: false,
            // Theme-aware border so the selected cell pops against the
            // current basemap: dark border on light maps, light border on
            // dark maps. (Stroke-only — the gradient mesh underneath
            // remains visible inside the selected cell.)
            getLineColor: theme === "dark" ? [17, 24, 39, 255] : [255, 255, 255, 255],
            getLineWidth: 2.5,
            lineWidthUnits: "pixels",
            lineWidthMinPixels: 2.5,
            pickable: false,
            updateTriggers: { getLineColor: [theme] },
          }),
        );
      }
    }

    // Protected / zavarovana areas overlay — drawn above every hex layer in
    // both 15-min and investor views so Triglavski narodni park and friends
    // read as "not applicable" rather than blending into the unpop pale-
    // parchment tile. Sits below iso/route/selected-hex layers so user
    // interactions stay legible. No cell scoring touched: this is pure visual.
    layers.push(
      new GeoJsonLayer({
        id: "protected-areas",
        data: PROTECTED_URL,
        stroked: true,
        filled: true,
        // Theme-aware translucent gray. Dark mode picks a *lighter* gray so
        // the polygon doesn't disappear into the darkened basemap.
        getFillColor: theme === "dark" ? [200, 200, 200, 90] : [80, 80, 80, 100],
        getLineColor: theme === "dark" ? [210, 210, 210, 180] : [60, 60, 60, 180],
        lineWidthMinPixels: 1,
        pickable: false,
        updateTriggers: { getFillColor: [theme], getLineColor: [theme] },
      }),
    );

    if (isoFeature) {
      layers.push(
        new GeoJsonLayer({
          id: "isochrone",
          data: isoFeature as GeoJSON.Feature,
          stroked: true,
          filled: true,
          getFillColor: [56, 189, 248, 60],
          getLineColor: [14, 116, 144, 220],
          lineWidthMinPixels: 2,
          pickable: false,
        }),
      );
    }

    if (routeSet && routeSet.paths.length > 0 && animatedPaths) {
      const catRgb = categoryById(routeSet.categoryId)?.color ?? FALLBACK_RGB;
      const PATH_RGBA: [number, number, number, number] = [catRgb[0], catRgb[1], catRgb[2], PATH_ALPHA];
      layers.push(
        new TripsLayer<AnimatedPath>({
          id: "routes-to-amenities",
          data: animatedPaths.paths,
          getPath: (d) => d.waypoints,
          getTimestamps: (d) => d.timestamps,
          getColor: PATH_RGBA,
          currentTime: animTime,
          trailLength: 1e9,
          getWidth: 6,
          widthUnits: "pixels",
          widthMinPixels: 5,
          jointRounded: true,
          capRounded: true,
          pickable: false,
          updateTriggers: { getColor: [routeSet.categoryId] },
        }),
        // Spark head: a short bright-white trail (80 ms window) that rides
        // the leading edge of each path. TripsLayer fades linearly from full
        // opacity at currentTime → transparent at currentTime-trailLength,
        // creating a glowing comet tip that disappears behind the main trail.
        new TripsLayer<AnimatedPath>({
          id: "routes-spark",
          data: animatedPaths.paths,
          getPath: (d) => d.waypoints,
          getTimestamps: (d) => d.timestamps,
          getColor: [255, 255, 255, 245],
          currentTime: animTime,
          trailLength: 80,
          getWidth: 3,
          widthUnits: "pixels",
          widthMinPixels: 2,
          jointRounded: true,
          capRounded: true,
          pickable: false,
        }),
      );
    }

    if (amenityDots && amenityDots.length > 0) {
      layers.push(
        new ScatterplotLayer<AmenityForPoint>({
          id: "amenity-dots",
          data: amenityDots,
          getPosition: (a) => [a.lng, a.lat],
          getFillColor: (a) => {
            const cat = categoryById(a.category as never);
            const rgb = cat?.color ?? [120, 120, 120];
            return [rgb[0], rgb[1], rgb[2], 230];
          },
          getRadius: 6,
          radiusUnits: "pixels",
          radiusMinPixels: 5,
          stroked: true,
          getLineColor: DOT_HALO,
          lineWidthMinPixels: 1.5,
          pickable: true,
          onHover: ({ object }) => setHoveredAmenity(object ?? null),
        }),
      );
    }

    // Larger same-color markers at each active-category path's destination,
    // rendered above amenity-dots so the visual relationship "this path leads
    // to this dot" is unambiguous. Not pickable — hover still falls through
    // to the underlying amenity-dots layer for the name label.
    if (routeSet && routeSet.paths.length > 0) {
      const catRgb = categoryById(routeSet.categoryId)?.color ?? FALLBACK_RGB;
      layers.push(
        new ScatterplotLayer<RoutePath["end"]>({
          id: "path-endpoints",
          data: routeSet.paths.map((p) => p.end),
          getPosition: (d) => [d.lng, d.lat],
          getFillColor: [catRgb[0], catRgb[1], catRgb[2], 240],
          getRadius: 9,
          radiusUnits: "pixels",
          radiusMinPixels: 7,
          stroked: true,
          getLineColor: [255, 255, 255, 240],
          lineWidthMinPixels: 2,
          pickable: false,
        }),
      );
    }

    // Origin marker — shown whenever paths to amenities are active, so the
    // user can see exactly where the paths start from. The disc is tinted by
    // the active category color; a white house SVG mask sits on top for a
    // clean monochrome glyph (replaces the old 🏠 emoji that looked dated).
    if (selectedH3 && routeSet && routeSet.paths.length > 0) {
      const [oLat, oLng] = originLngLat
        ? [originLngLat[1], originLngLat[0]]
        : h3.cellToLatLng(selectedH3);
      const originPos: [number, number] = [oLng, oLat];
      const originRgb = categoryById(routeSet.categoryId)?.color ?? [14, 165, 233];
      layers.push(
        new ScatterplotLayer<{ position: [number, number] }>({
          id: "origin-pin-bg",
          data: [{ position: originPos }],
          getPosition: (d) => d.position,
          getFillColor: [originRgb[0], originRgb[1], originRgb[2], 240],
          getRadius: 16,
          radiusUnits: "pixels",
          radiusMinPixels: 14,
          stroked: true,
          getLineColor: [255, 255, 255, 240],
          lineWidthMinPixels: 2,
          pickable: false,
        }),
        new IconLayer<{ position: [number, number] }>({
          id: "origin-pin",
          data: [{ position: originPos }],
          iconAtlas: HOME_ICON_URL,
          iconMapping: HOME_ICON_MAPPING,
          getIcon: () => "home",
          getPosition: (d) => d.position,
          getSize: 20,
          sizeUnits: "pixels",
          getColor: [255, 255, 255, 255],
          pickable: false,
        }),
      );
    }

    // When a category is selected (routeSet is active), suppress hover labels
    // for non-matching categories — only the active category's dots show names.
    const showHoverLabel =
      hoveredAmenity && (!routeSet || hoveredAmenity.category === routeSet.categoryId);
    if (showHoverLabel) {
      layers.push(
        new TextLayer<AmenityForPoint>({
          id: "amenity-hover-label",
          data: [hoveredAmenity],
          getText: (a) => a.name ?? a.category,
          getPosition: (a) => [a.lng, a.lat],
          getSize: 13,
          getColor: [17, 24, 39, 240],
          getPixelOffset: [0, -14],
          background: true,
          getBackgroundColor: [255, 255, 255, 235],
          backgroundPadding: [5, 3],
          fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif",
          fontWeight: 500,
          getAlignmentBaseline: "bottom",
          getTextAnchor: "middle",
          // Critical: deck.gl's default characterSet is ASCII-only, so 'š'/'č'/'ž'
          // would silently drop. 'auto' walks the rendered data and bakes a font
          // atlas with every glyph encountered.
          characterSet: "auto",
          pickable: false,
        }),
      );
    }

    if (groupedPins.length > 0) {
      const maxDemand = groupedPins.reduce(
        (m, p) => Math.max(m, p.items[0]?.distanceM ?? 0), 1,
      );
      layers.push(
        new ScatterplotLayer<GroupedPin>({
          id: "suggestions",
          data: groupedPins,
          getPosition: (d) => [d.lng, d.lat],
          getRadius: (d) => {
            const demand = d.items[0]?.distanceM ?? 1;
            return 3 + 5 * Math.sqrt(demand / maxDemand);
          },
          radiusUnits: "pixels",
          radiusMinPixels: 3,
          getFillColor: (d) =>
            d.boostKind
              ? BOOST_COLOR
              : d.items[0]?.source === "fro"
                ? [239, 68, 68, 200]
                : [250, 204, 21, 200],
          getLineColor: [255, 255, 255, 200],
          lineWidthMinPixels: 1,
          stroked: true,
          pickable: true,
          updateTriggers: { getRadius: groupedPins },
        }),
      );
    }

    if (searchResults.length > 0) {
      const PIN_BLUE: [number, number, number, number] = [37, 99, 235, 240];
      layers.push(
        new ScatterplotLayer<SearchResult>({
          id: "ai-search-pins",
          data: searchResults,
          getPosition: (d) => {
            const [lat, lng] = h3.cellToLatLng(d.h3);
            return [lng, lat];
          },
          getRadius: (d) => (d.h3 === hoveredResultH3 ? 14 : 10),
          radiusUnits: "pixels",
          getFillColor: PIN_BLUE,
          getLineColor: [255, 255, 255, 230],
          lineWidthMinPixels: 2,
          stroked: true,
          pickable: true,
          onHover: (info) => {
            const next = (info?.object as SearchResult | null)?.h3 ?? null;
            if (next !== hoveredResultH3) setHoveredResultH3(next);
          },
          updateTriggers: { getRadius: hoveredResultH3 },
        }),
      );
    }

    overlay.setProps({ layers, getTooltip: suggestionTooltip });
  }, [aggregatedScores, aggregatedInvestorCells, aggregatedUnpop, demandThresholds, catScores, investorCat, groupedPins, cellsMap, showObcineFill, currentRes, view, isoFeature, routeSet, amenityDots, hoveredAmenity, mode, selectedH3, selectedObcina, originLngLat, animatedPaths, animTime, theme, fadeProgress, searchResults, hoveredResultH3]);

  const suggestionTooltip = ({ object, layer }: { object?: unknown; layer?: { id: string } | null }) => {
    if (layer?.id !== "suggestions" || !object) return null;
    const pin = object as GroupedPin;
    const rows = pin.items.map((s, idx) => {
      const cat = CATEGORIES[s.categoryIndex];
      const reason =
        ZONE_REASONS[s.zoneCode]?.[s.categoryIndex] ??
        `Primerno za ${cat?.label.toLowerCase() ?? ""}`;
      const demandStr = s.distanceM > 0 ? `Povpraševanje: ${Math.round(s.distanceM)}` : "";
      const membersStr = s.members ? ` · ${s.members} območij` : "";
      const iconSvg = cat
        ? `<svg viewBox="0 0 24 24" width="18" height="18" fill="#374151" style="flex-shrink:0;"><path d="${cat.iconPath}"/></svg>`
        : `<span style="font-size:14px;flex-shrink:0">📍</span>`;
      return `<div style="display:flex;gap:8px;align-items:flex-start;padding:5px 0;${idx > 0 ? "border-top:1px solid #f0f0f0;" : ""}">
        ${iconSvg}
        <div>
          <div style="font-weight:600;font-size:13px">${cat?.label ?? ""}</div>
          <div style="color:#555;font-size:12px;margin-top:1px">${reason}</div>
          <div style="color:#999;font-size:11px;margin-top:2px">${demandStr}${membersStr}</div>
        </div>
      </div>`;
    }).join("");
    let boostNote = "";
    if (pin.boostKind === "elderly") {
      boostNote = `<div style="margin-top:6px;padding:6px 8px;background:#eff6ff;border-left:3px solid #2563eb;border-radius:4px;font-size:11px;color:#1e3a8a;line-height:1.4">
          <strong>Spodbujeno z deležem starejših.</strong> Občina presega prag
          ${(ELDERLY_THRESHOLD_ZDRAVSTVO * 100).toFixed(0)} % prebivalcev starih 65+,
          zato je tu posebej smiselno umestiti zdravstvene objekte.
        </div>`;
    } else if (pin.boostKind === "kids") {
      boostNote = `<div style="margin-top:6px;padding:6px 8px;background:#eff6ff;border-left:3px solid #2563eb;border-radius:4px;font-size:11px;color:#1e3a8a;line-height:1.4">
          <strong>Spodbujeno z deležem otrok.</strong> Občina presega prag
          ${(KIDS_THRESHOLD_IZOBRAZEVANJE * 100).toFixed(0)} % prebivalcev starih 0–14 let,
          zato je tu posebej smiselno umestiti šole in vrtce.
        </div>`;
    }
    return {
      html: `<div style="max-width:260px">
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#999;margin-bottom:4px">
          ${pin.items[0]?.source === "fro" ? "🔴 Degradirano območje · Predlagana revitalizacija" : `OPN cona ${pin.zoneCode} · Predlagana gradnja`}
        </div>${rows}${boostNote}</div>`,
      style: {
        background: "white", padding: "10px 12px", borderRadius: "10px",
        boxShadow: "0 4px 16px rgba(0,0,0,0.15)", border: "1px solid rgba(0,0,0,0.06)",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      },
    };
  };

  // View switcher must close the scorecard first if it's open. Switching while
  // a cell is selected leaves stale iso polygons / category routes / amenity
  // dots layered over the new view's data, which looks broken.
  const switchView = (next: View) => {
    if (next === view) return;
    if (selectedH3) {
      if (originFromAddress) addressSearchRef.current?.clear();
      setSelectedH3(null);
      setHoveredAmenity(null);
      setOriginLngLat(null);
      setOriginFromAddress(false);
    }
    setView(next);
  };

  const flyToCoord = (lng: number, lat: number, targetZoom = 14, fromAddress = false) => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: [lng, lat], zoom: targetZoom, duration: 1200 });
    setTimeout(() => {
      setSelectedH3(h3.latLngToCell(lat, lng, H3_BASE_RES));
      setOriginLngLat([lng, lat]);
      setOriginFromAddress(fromAddress);
    }, 200);
  };

  return (
    <>
      {/* v1 ChatBox kept importable for one-line rollback */}
      {/* <ChatBox onSelectH3={setSelectedH3} flyToCoord={flyToCoord} /> */}
      <ResultCard
        onResultsChange={setSearchResults}
        onRowHover={setHoveredResultH3}
        highlightH3={hoveredResultH3}
        onZoomToResult={(r) => {
          const [lat, lng] = h3.cellToLatLng(r.h3);
          flyToCoord(lng, lat, 14);
          setTimeout(() => setSelectedH3(r.h3), 200);
        }}
      />
      <div id="map-root" ref={containerRef} />

      <div className="top-row">
        <AddressSearch
          ref={addressSearchRef}
          onPick={(lng, lat) => flyToCoord(lng, lat, 14, true)}
        />
        <div className="view-switch" role="group" aria-label="Pogled">
          <button
            type="button"
            className={view === "15min" ? "active" : ""}
            onClick={() => switchView("15min")}
            aria-pressed={view === "15min"}
          >
            Potrošnik
          </button>
          <button
            type="button"
            className={view === "investor" ? "active" : ""}
            onClick={() => switchView("investor")}
            aria-pressed={view === "investor"}
          >
            Investitor
          </button>
        </div>
      </div>

      {view === "15min" ? (
        <div className={`legend ${legendOpen ? "is-open" : "is-collapsed"}`}>
          <button
            type="button"
            className="legend-toggle"
            onClick={() => setLegendOpen((o) => !o)}
            aria-expanded={legendOpen}
            aria-controls="legend-body"
          >
            <span>Legenda ocen</span>
            <svg
              className="legend-chevron"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {legendOpen && (
            <div id="legend-body" className="legend-body">
              <div className="legend-row">
                <span className="legend-swatch" style={{ background: "rgb(16,185,129)" }} />
                6–8 / 8
              </div>
              <div className="legend-row">
                <span className="legend-swatch" style={{ background: "rgb(234,179,8)" }} />
                4–5 / 8
              </div>
              <div className="legend-row">
                <span className="legend-swatch" style={{ background: "rgb(249,115,22)" }} />
                2–3 / 8
              </div>
              <div className="legend-row">
                <span className="legend-swatch" style={{ background: "rgb(239,68,68)" }} />
                0–1 / 8
              </div>
              <div className="legend-row">
                <span className="legend-swatch" style={{ background: "rgb(120,120,120)" }} />
                Zavarovano (izvzeto)
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className={`legend ${legendOpen ? "is-open" : "is-collapsed"}`}>
          <button
            type="button"
            className="legend-toggle"
            onClick={() => setLegendOpen((o) => !o)}
            aria-expanded={legendOpen}
            aria-controls="legend-body"
          >
            <span>Investicijski potencial</span>
            <svg
              className="legend-chevron"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {legendOpen && (
            <div id="legend-body" className="legend-body">
              <div className="legend-row">
                <span className="legend-swatch" style={{ background: "rgb(253,231,37)" }} />
                Visok
              </div>
              <div className="legend-row">
                <span className="legend-swatch" style={{ background: "rgb(53,183,121)" }} />
                Srednji
              </div>
              <div className="legend-row">
                <span className="legend-swatch" style={{ background: "rgb(49,104,142)" }} />
                Nizek
              </div>
              <div className="legend-row">
                <span className="legend-swatch" style={{ background: "rgb(68,1,84)" }} />
                Zanemarljiv
              </div>
              <div className="legend-row">
                <span className="legend-swatch" style={{ background: "rgb(120,120,120)" }} />
                Zavarovano (izvzeto)
              </div>
            </div>
          )}
        </div>
      )}

      {view === "investor" && !selectedH3 && (
        <div className="investor-cat-filter" role="group" aria-label="Filter kategorije">
          <button
            type="button"
            className={`investor-cat-pill ${investorCat === null ? "active" : ""}`}
            onClick={() => setInvestorCat(null)}
          >
            <span className="investor-cat-ico" aria-hidden>✱</span>
            <span className="investor-cat-label">Vse kategorije</span>
          </button>
          {CATEGORIES.map((cat, i) => (
            <button
              key={cat.id}
              type="button"
              className={`investor-cat-pill ${investorCat === i ? "active" : ""}`}
              onClick={() => setInvestorCat(investorCat === i ? null : i)}
            >
              <span className="investor-cat-ico" aria-hidden>
                <svg viewBox="0 0 24 24" fill="currentColor"><path d={cat.iconPath} /></svg>
              </span>
              <span className="investor-cat-label">{cat.label}</span>
            </button>
          ))}
        </div>
      )}

      {(view === "15min" || view === "investor") && (
        <div className="mode-toggle-global" role="group" aria-label="Način">
          <button
            type="button"
            className={mode === "walk" ? "active" : ""}
            onClick={() => setMode("walk")}
            aria-pressed={mode === "walk"}
          >
            Hoja
          </button>
          <button
            type="button"
            className={mode === "bike" ? "active" : ""}
            onClick={() => setMode("bike")}
            aria-pressed={mode === "bike"}
          >
            Kolo
          </button>
        </div>
      )}

      <Scorecard
        h3id={selectedH3}
        mode={mode}
        originLngLat={originLngLat}
        obcinaName={cellObcinaName}
        onClose={() => {
          if (originFromAddress) addressSearchRef.current?.clear();
          setSelectedH3(null);
          setHoveredAmenity(null);
          setOriginLngLat(null);
          setOriginFromAddress(false);
        }}
        onIsochrone={setIsoFeature}
        onRoute={setRouteSet}
        onAmenities={(set) => {
          setAmenityDots(set);
          if (!set) setHoveredAmenity(null);
        }}
      />

      {selectedObcina && (
        <ObcinaInfoCard
          obcina={selectedObcina}
          mode={mode}
          onClose={() => setSelectedObcina(null)}
        />
      )}

      <div className="bottom-left-cluster">
        <ThemeToggle />
        <button
          type="button"
          className="provenance-text-link"
          onClick={() => setProvenanceOpen(true)}
        >
          Od kod podatki?
        </button>
      </div>
      {provenanceOpen && <IzvorPodatkov onClose={() => setProvenanceOpen(false)} />}

      {(cellsLoading ||
        (view === "investor" && !demandError && (
          demandLoading ||
          unpopCells.length === 0 ||
          investorCells.length === 0 ||
          unpopComputing ||
          investorComputing
        ))) && (
        <div className="loading-banner" role="status" aria-live="polite">
          Nalagam podatke …
        </div>
      )}

      {usingDummy && cellsError && (
        <div className="banner">
          Podatki s strežnika niso dosegljivi ({cellsError}). Prikazane so vzorčne celice.
        </div>
      )}

      {view === "investor" && demandError && (
        <div className="banner" role="alert">
          Napaka pri nalaganju podatkov za investitorja ({demandError}). Poskusi
          osvežiti stran ali preklopi na potrošniški pogled.
        </div>
      )}


    </>
  );
}
