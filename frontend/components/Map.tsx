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
import AddressSearch, { type AddressSearchHandle } from "@/components/AddressSearch";
import IzvorPodatkov from "@/components/IzvorPodatkov";
import ChatBox from "@/components/ChatBox";
import ThemeToggle from "@/components/ThemeToggle";
import { categoryById, CATEGORIES, ICON_HOME } from "@/lib/categories";
import type { AmenityForPoint } from "@/lib/supabase";
import { useTheme } from "@/lib/theme";
import { ZONE_REASONS, type Suggestion } from "@/lib/suggestions";

type GroupedPin = {
  lat: number;
  lng: number;
  zoneCode: string;
  zoneDesc: string;
  items: Suggestion[];
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
const POPULATION_URL = REMOTE_DATA
  ? `${STORAGE}/overlays/cell_population_lite.json`
  : "/data/cell_population_lite.json";

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
type PopCell = { h3: string; pop: number };
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
  const [pops, setPops] = useState<PopCell[]>([]);
  const [popsLoading, setPopsLoading] = useState(false);
  // Cached obcine GeoJSON — used client-side to synthesize the H3 cells over
  // unpopulated parts of Slovenia. Browser HTTP cache deduplicates with the
  // deck.gl GeoJsonLayer fetch.
  const [obcineFC, setObcineFC] = useState<GeoJSON.FeatureCollection | null>(null);
  const [zoom, setZoom] = useState<number>(INITIAL_ZOOM);
  const [usingDummy, setUsingDummy] = useState<boolean>(false);
  const [selectedH3, setSelectedH3] = useState<string | null>(null);
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
  // Investor view state — per-category scores, the active category filter,
  // and the precomputed building-suggestion pins shown on top of the demand
  // heatmap when a category is active.
  const [catScores, setCatScores] = useState<Map<string, number[]>>(new Map());
  const [investorCat, setInvestorCat] = useState<number | null>(null);
  const [suggestionPins, setSuggestionPins] = useState<Suggestion[]>([]);
  const [buildingSuggestions, setBuildingSuggestions] = useState<
    Record<string, { lat: number; lng: number; source: string; demand: number; members: number }[]>
  >({});

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

  // Lazy-load population on first switch. Deps deliberately omit popsLoading.
  useEffect(() => {
    if (view !== "investor" || pops.length > 0) return;
    let cancelled = false;
    setPopsLoading(true);
    (async () => {
      try {
        const res = await fetch(POPULATION_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: PopCell[] = await res.json();
        if (!cancelled) setPops(data);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("Population fetch failed:", err);
      } finally {
        if (!cancelled) setPopsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view, pops.length]);

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
    map.on("zoom", sync);
    map.on("moveend", sync);

    return () => {
      map.off("zoom", sync);
      map.off("moveend", sync);
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror selectedH3 into both the ref (for the closure-captured sync
  // handler) and the URL hash.
  useEffect(() => {
    selectedH3Ref.current = selectedH3;
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

  const aggregatedScores = useMemo(
    () => (showObcineFill ? [] : aggregateMean(cells, currentRes)),
    [cells, currentRes, showObcineFill],
  );

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
    if (!obcineFC || cells.length === 0 || pops.length === 0) {
      setUnpopCells([]);
      setUnpopComputing(false);
      return;
    }
    let cancelled = false;
    setUnpopComputing(true);
    // setTimeout (a macrotask) — unlike rAF — is guaranteed to run AFTER the
    // browser has had a chance to paint. So the "Nalagam podatke …" banner
    // (driven by setUnpopComputing above) appears on screen BEFORE this
    // synchronous compute starts blocking the main thread.
    const id = setTimeout(() => {
      if (cancelled) return;
      const populatedRes10 = new Set(cells.map((c) => c.h3));
      const populatedRes9 = new Set(pops.map((p) => p.h3));
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
  }, [obcineFC, cells, pops]);

  // Aggregate unpopulated cells to currentRes so they match the on-screen hex
  // size of the score / investor data they sit underneath. At res-10 itself
  // it's a no-op; below, we dedupe by parent so each rendered hex appears once.
  const aggregatedUnpop = useMemo<string[]>(() => {
    if (showObcineFill) return [];
    if (currentRes >= H3_BASE_RES) return unpopCells;
    const parents = new Set<string>();
    for (const c of unpopCells) parents.add(h3.cellToParent(c, currentRes));
    return Array.from(parents);
  }, [unpopCells, currentRes, showObcineFill]);

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

  // Keyed by h3 for O(1) child lookup in investor onClick.
  const cellsMap = useMemo(() => new Map(cells.map((c) => [c.h3, c])), [cells]);

  const groupedPins = useMemo<GroupedPin[]>(() => {
    const map = new Map<string, GroupedPin>();
    for (const s of suggestionPins) {
      const key = `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`;
      const existing = map.get(key);
      if (existing) existing.items.push(s);
      else map.set(key, { lat: s.lat, lng: s.lng, zoneCode: s.zoneCode, zoneDesc: s.zoneDesc, items: [s] });
    }
    return Array.from(map.values());
  }, [suggestionPins]);

  // Per-cell investor demand (population × unmet share). Heavy: 1 M cells, and
  // before this refactor we called h3.cellToParent twice per cell. Same
  // double-rAF defer as unpopCells, plus we cache the parent lookup so the
  // compute runs ~half as long. `investorComputing` is the gate.
  const [investorCells, setInvestorCells] = useState<DemandCell[]>([]);
  const [investorComputing, setInvestorComputing] = useState(false);

  useEffect(() => {
    if (cells.length === 0 || pops.length === 0) {
      setInvestorCells([]);
      setInvestorComputing(false);
      return;
    }
    let cancelled = false;
    setInvestorComputing(true);
    // See unpopCells effect above — setTimeout (a macrotask) is the reliable
    // way to ensure the banner paints before the synchronous compute starts.
    const id = setTimeout(() => {
      if (cancelled) return;
      // Cache cellToParent once per cell — the old useMemo called it twice
      // (childCount + demand loops), so this roughly halves the h3 work.
      const parents: string[] = new Array(cells.length);
      for (let i = 0; i < cells.length; i++) {
        parents[i] = h3.cellToParent(cells[i].h3, 9);
      }

      const popMap = new Map(pops.map((p) => [p.h3, p.pop]));
      const childCount = new Map<string, number>();
      for (let i = 0; i < cells.length; i++) {
        const p9 = parents[i];
        childCount.set(p9, (childCount.get(p9) ?? 0) + 1);
      }

      const out: DemandCell[] = new Array(cells.length);
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        const p9 = parents[i];
        const parentPop = popMap.get(p9) ?? 0;
        const pop = parentPop > 0 ? parentPop / (childCount.get(p9) ?? 1) : 0;

        let demand = 0;
        if (investorCat !== null && catScores.size > 0) {
          const catArr = catScores.get(p9);
          if (catArr) {
            const present = catArr[investorCat];
            demand = present >= 1 ? 0 : pop * (1 - present);
          }
          out[i] = { h3: c.h3, walkDemand: demand, bikeDemand: demand };
        } else {
          out[i] = {
            h3: c.h3,
            walkDemand: pop * (1 - c.w / 8),
            bikeDemand: pop * (1 - c.b / 8),
          };
        }
      }
      if (!cancelled) {
        setInvestorCells(out);
        setInvestorComputing(false);
      }
    }, 50);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [cells, pops, investorCat, catScores]);

  const aggregatedInvestorCells = useMemo(
    () => (showObcineFill ? [] : aggregateDemand(investorCells, currentRes)),
    [investorCells, currentRes, showObcineFill],
  );

  const demandThresholds = useMemo<DemandThresholds>(() => {
    if (aggregatedInvestorCells.length === 0) return { p50: 1, p75: 2, p90: 4 };
    // Filter zero-demand cells out of the percentile calc — they're the
    // "zanemarljivo" sink (fully-served zones, etc.) and would otherwise
    // collapse p50 to zero whenever a saturated category is selected,
    // causing every cell to register as `demand >= p50` and paint teal.
    const vals = aggregatedInvestorCells
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
  }, [aggregatedInvestorCells, mode]);

  // Lazy-load pre-computed building suggestions once when investor view is opened.
  useEffect(() => {
    if (view !== "investor" || Object.keys(buildingSuggestions).length > 0) return;
    fetch("/data/building_suggestions.json")
      .then((r) => r.json())
      .then(setBuildingSuggestions)
      .catch((err) => console.warn("building_suggestions fetch failed:", err));
  }, [view, buildingSuggestions]);

  // Show pins for the active category filter — instant, no network calls.
  useEffect(() => {
    if (view !== "investor" || investorCat === null) {
      setSuggestionPins([]);
      return;
    }
    const raw = buildingSuggestions[String(investorCat)] ?? [];
    setSuggestionPins(
      raw.map((s) => ({
        categoryIndex: investorCat,
        lat: s.lat,
        lng: s.lng,
        zoneCode: s.source === "fro" ? "FRO" : "OPN",
        zoneDesc: s.source === "fro" ? "Degradirano območje" : "Predlagana lokacija",
        distanceM: s.demand,   // repurpose field to carry demand for tooltip
        source: (s.source === "fro" ? "fro" : "opn") as "fro" | "opn",
        members: s.members,
      })),
    );
  }, [view, investorCat, buildingSuggestions]);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    // In dark mode, pull all hex fill RGB values down to 65 % so they sit
    // naturally on the darkened basemap without washing it out.
    const hexDark = theme === "dark";
    const dk = (c: Rgba): Rgba =>
      hexDark ? [Math.round(c[0] * 0.65), Math.round(c[1] * 0.65), Math.round(c[2] * 0.65), c[3]] : c;

    const layers: Layer[] = [];

    // Unpopulated cells — painted first so they sit beneath all data layers.
    // Only relevant at hex zoom; below `SHOW_OBCINE_FILL_BELOW` the obcina
    // fill already covers Slovenia uniformly.
    if (!showObcineFill && aggregatedUnpop.length > 0) {
      layers.push(
        new H3HexagonLayer<string>({
          id: "unpop-hex",
          data: aggregatedUnpop,
          pickable: false,
          stroked: false,
          filled: true,
          extruded: false,
          getHexagon: (d) => d,
          getFillColor: hexDark ? [138, 135, 122, 150] : UNPOP_COLOR,
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
              return dk(colorForDemand(d, demandThresholds));
            },
            getLineColor: [60, 60, 60, 200],
            lineWidthMinPixels: 1,
            pickable: false,
            updateTriggers: { getFillColor: [mode, demandThresholds, hexDark] },
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
            getFillColor: (d) => dk(colorForDemand(mode === "walk" ? d.walkDemand : d.bikeDemand, demandThresholds)),
            getLineColor: [255, 255, 255, 70],
            lineWidthUnits: "pixels",
            getLineWidth: 0.5,
            updateTriggers: { getFillColor: [mode, demandThresholds, hexDark] },
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
            return dk(colorForScore(v));
          },
          getLineColor: [60, 60, 60, 200],
          lineWidthMinPixels: 1,
          pickable: false,
          updateTriggers: { getFillColor: [mode, hexDark] },
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
          getFillColor: (d) => dk(colorForScore(mode === "bike" ? d.b : d.w)),
          getLineColor: [255, 255, 255, 70],
          lineWidthUnits: "pixels",
          getLineWidth: 0.5,
          updateTriggers: { getFillColor: [aggregatedScores, mode, hexDark] },
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
          getFillColor: (d) => d.items[0]?.source === "fro" ? [239, 68, 68, 200] : [250, 204, 21, 200],
          getLineColor: [255, 255, 255, 200],
          lineWidthMinPixels: 1,
          stroked: true,
          pickable: true,
          updateTriggers: { getRadius: groupedPins },
        }),
      );
    }

    overlay.setProps({ layers, getTooltip: suggestionTooltip });
  }, [aggregatedScores, aggregatedInvestorCells, aggregatedUnpop, demandThresholds, catScores, investorCat, groupedPins, cellsMap, showObcineFill, currentRes, view, isoFeature, routeSet, amenityDots, hoveredAmenity, mode, selectedH3, originLngLat, animatedPaths, animTime, theme]);

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
    return {
      html: `<div style="max-width:240px">
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#999;margin-bottom:4px">
          ${pin.items[0]?.source === "fro" ? "🔴 Degradirano območje · Predlagana revitalizacija" : `OPN cona ${pin.zoneCode} · Predlagana gradnja`}
        </div>${rows}</div>`,
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
      <ChatBox onSelectH3={setSelectedH3} flyToCoord={flyToCoord} />
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
              {popsLoading && <div className="legend-loading">nalagam …</div>}
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
        (view === "investor" && (
          popsLoading ||
          pops.length === 0 ||
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


    </>
  );
}
