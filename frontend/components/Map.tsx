"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer } from "@deck.gl/core";
import { GeoJsonLayer, PathLayer, TextLayer, ScatterplotLayer } from "@deck.gl/layers";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import * as h3 from "h3-js";
import Scorecard, { type RouteSet, type RoutePath } from "@/components/Scorecard";
import AddressSearch from "@/components/AddressSearch";
import IzvorPodatkov from "@/components/IzvorPodatkov";
import { categoryById, CATEGORIES } from "@/lib/categories";
import type { AmenityForPoint } from "@/lib/supabase";
import { fetchSuggestions, ZONE_REASONS, type Suggestion } from "@/lib/suggestions";

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
import ChatBox from "@/components/ChatBox";

const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

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

type View = "15min" | "population" | "investor";
export type Mode = "walk" | "bike";

/** Score JSON shape: {h3, w, b} — walk & bike scores baked together. */
type ScoreCell = { h3: string; w: number; b: number };
type PopCell = { h3: string; pop: number };
type PopPoint = { position: [number, number]; pop: number };
type DemandCell = { h3: string; walkDemand: number; bikeDemand: number };
type DemandThresholds = { p50: number; p75: number; p90: number };

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function zoomToResolution(zoom: number): number {
  if (zoom < 10) return 6;
  if (zoom < 11) return 7;
  if (zoom < 13) return 8;
  if (zoom < 15) return 9;
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

function colorForDemand(demand: number, t: DemandThresholds): Rgba {
  if (demand >= t.p90) return [6, 182, 212, 128];   // cyan — visok potencial
  if (demand >= t.p75) return [59, 130, 246, 128];  // modra — srednji
  if (demand >= t.p50) return [99, 102, 241, 128];  // indigo-modra — nizek
  return [139, 92, 246, 128];                        // vijolična — zanemarljiv
}

function colorForScore(score: number): Rgba {
  if (score >= 6) return [16, 185, 129, 128];
  if (score >= 4) return [234, 179, 8, 128];
  if (score >= 2) return [249, 115, 22, 128];
  return [239, 68, 68, 128];
}

const HEATMAP_COLOR_RANGE: Array<[number, number, number]> = [
  [20, 14, 54],
  [70, 16, 110],
  [136, 35, 130],
  [196, 70, 105],
  [240, 130, 80],
  [252, 253, 191],
];

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
  const [zoom, setZoom] = useState<number>(INITIAL_ZOOM);
  const [usingDummy, setUsingDummy] = useState<boolean>(false);
  const [selectedH3, setSelectedH3] = useState<string | null>(null);
  const [isoFeature, setIsoFeature] = useState<GeoJSON.Feature | null>(null);
  const [routeSet, setRouteSet] = useState<RouteSet | null>(null);
  const [amenityDots, setAmenityDots] = useState<AmenityForPoint[] | null>(null);
  const [hoveredAmenity, setHoveredAmenity] = useState<AmenityForPoint | null>(null);
  const [provenanceOpen, setProvenanceOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("walk");
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

  // Lazy-load population on first switch. Deps deliberately omit popsLoading.
  useEffect(() => {
    if ((view !== "population" && view !== "investor") || pops.length > 0) return;
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

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      center,
      zoom: zoomInit,
    });
    mapRef.current = map;

    const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
    overlayRef.current = overlay;
    map.addControl(overlay as unknown as maplibregl.IControl);

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

  const showObcineFill = zoom < SHOW_OBCINE_FILL_BELOW;
  const currentRes = zoomToResolution(zoom);

  const aggregatedScores = useMemo(
    () => (showObcineFill ? [] : aggregateMean(cells, currentRes)),
    [cells, currentRes, showObcineFill],
  );

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

  const popPoints = useMemo<PopPoint[]>(() => {
    if (pops.length === 0) return [];
    const out: PopPoint[] = new Array(pops.length);
    for (let i = 0; i < pops.length; i++) {
      const [lat, lng] = h3.cellToLatLng(pops[i].h3);
      out[i] = { position: [lng, lat], pop: pops[i].pop };
    }
    return out;
  }, [pops]);

  const investorCells = useMemo<DemandCell[]>(() => {
    if (pops.length === 0 || cells.length === 0) return [];
    // Population is at res-9; distribute evenly across res-10 children.
    const popMap = new Map(pops.map((p) => [p.h3, p.pop]));
    const childCount = new Map<string, number>();
    for (const c of cells) {
      const p9 = h3.cellToParent(c.h3, 9);
      childCount.set(p9, (childCount.get(p9) ?? 0) + 1);
    }
    const out: DemandCell[] = [];
    for (const c of cells) {
      const p9 = h3.cellToParent(c.h3, 9);
      const parentPop = popMap.get(p9) ?? 0;
      if (parentPop === 0) continue;
      const pop = parentPop / (childCount.get(p9) ?? 1);

      if (investorCat !== null && catScores.size > 0) {
        // catScores is at res-9 — look up parent
        const catArr = catScores.get(p9);
        if (!catArr) continue;
        const present = catArr[investorCat];
        if (present >= 1) continue;
        const d = pop * (1 - present);
        out.push({ h3: c.h3, walkDemand: d, bikeDemand: d });
      } else {
        out.push({
          h3: c.h3,
          walkDemand: pop * (1 - c.w / 8),
          bikeDemand: pop * (1 - c.b / 8),
        });
      }
    }
    return out;
  }, [cells, pops, investorCat, catScores]);

  const aggregatedInvestorCells = useMemo(
    () => (showObcineFill ? [] : aggregateDemand(investorCells, currentRes)),
    [investorCells, currentRes, showObcineFill],
  );

  const demandThresholds = useMemo<DemandThresholds>(() => {
    if (aggregatedInvestorCells.length === 0) return { p50: 1, p75: 2, p90: 4 };
    const vals = aggregatedInvestorCells
      .map((c) => (mode === "walk" ? c.walkDemand : c.bikeDemand))
      .sort((a, b) => a - b);
    const n = vals.length;
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

    const layers: Layer[] = [];

    if (view === "population") {
      layers.push(
        new HeatmapLayer<PopPoint>({
          id: "population-heat",
          data: popPoints,
          getPosition: (d) => d.position,
          getWeight: (d) => d.pop,
          aggregation: "SUM",
          radiusPixels: 40,
          intensity: 1,
          threshold: 0.03,
          opacity: 0.5,
          colorRange: HEATMAP_COLOR_RANGE,
          pickable: false,
        }),
      );
    } else if (view === "investor") {
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
              return colorForDemand(d, demandThresholds);
            },
            getLineColor: [60, 60, 60, 200],
            lineWidthMinPixels: 1,
            pickable: false,
            updateTriggers: { getFillColor: [mode, demandThresholds] },
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
            getFillColor: (d) => colorForDemand(mode === "walk" ? d.walkDemand : d.bikeDemand, demandThresholds),
            getLineColor: [255, 255, 255, 70],
            lineWidthUnits: "pixels",
            getLineWidth: 0.5,
            updateTriggers: { getFillColor: [mode, demandThresholds] },
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
            // Pick the mode-appropriate mean; fall back to legacy `mean_score`
            // (pre-bike-rescore obcine files) so loading old data still renders.
            const v = (mode === "bike" ? p.bike_mean : p.walk_mean) ?? p.mean_score ?? 0;
            return colorForScore(v);
          },
          getLineColor: [60, 60, 60, 200],
          lineWidthMinPixels: 1,
          pickable: false,
          updateTriggers: { getFillColor: mode },
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
          pickable: true, // click-only (no onHover) — perf hit acceptable
          stroked: true,
          filled: true,
          extruded: false,
          getHexagon: (d) => d.h3,
          getFillColor: (d) => colorForScore(mode === "bike" ? d.b : d.w),
          getLineColor: [255, 255, 255, 70],
          lineWidthUnits: "pixels",
          getLineWidth: 0.5,
          updateTriggers: { getFillColor: [aggregatedScores, mode] },
          onClick: ({ object }) => {
            if (!object) return;
            // Convert aggregated h3 to a representative res-10 child for
            // scorecard fetch; if already res-10 use as-is.
            const target =
              h3.getResolution(object.h3) >= H3_BASE_RES
                ? object.h3
                : h3.cellToChildren(object.h3, H3_BASE_RES)[0];
            setSelectedH3(target);
          },
        }),
      );
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

    if (routeSet && routeSet.paths.length > 0) {
      const catRgb = categoryById(routeSet.categoryId)?.color ?? FALLBACK_RGB;
      const PATH_RGBA: [number, number, number, number] = [catRgb[0], catRgb[1], catRgb[2], PATH_ALPHA];
      layers.push(
        new PathLayer<{ path: [number, number][] }>({
          id: "routes-to-amenities",
          data: routeSet.paths.map((p) => ({ path: p.shape })),
          getPath: (d) => d.path,
          getColor: PATH_RGBA,
          getWidth: 4,
          widthUnits: "pixels",
          widthMinPixels: 3,
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

    if (hoveredAmenity) {
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
  }, [aggregatedScores, popPoints, aggregatedInvestorCells, demandThresholds, catScores, investorCat, groupedPins, cellsMap, showObcineFill, currentRes, view, isoFeature, routeSet, amenityDots, hoveredAmenity, mode]);

  const suggestionTooltip = ({ object, layer }: { object: unknown; layer: { id: string } | null }) => {
    if (layer?.id !== "suggestions" || !object) return null;
    const pin = object as GroupedPin;
    const rows = pin.items.map((s, idx) => {
      const cat = CATEGORIES[s.categoryIndex];
      const reason =
        ZONE_REASONS[s.zoneCode]?.[s.categoryIndex] ??
        `Primerno za ${cat?.label.toLowerCase() ?? ""}`;
      const demandStr = s.distanceM > 0 ? `Povpraševanje: ${Math.round(s.distanceM)}` : "";
      const membersStr = s.members ? ` · ${s.members} območij` : "";
      return `<div style="display:flex;gap:8px;align-items:flex-start;padding:5px 0;${idx > 0 ? "border-top:1px solid #f0f0f0;" : ""}">
        <span style="font-size:16px;flex-shrink:0">${cat?.icon ?? "📍"}</span>
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

  const flyToCoord = (lng: number, lat: number, targetZoom = 14) => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: [lng, lat], zoom: targetZoom, duration: 1200 });
    setTimeout(() => {
      setSelectedH3(h3.latLngToCell(lat, lng, H3_BASE_RES));
    }, 200);
  };

  return (
    <>
      <ChatBox onSelectH3={setSelectedH3} flyToCoord={flyToCoord} />
      <div id="map-root" ref={containerRef} />

      <AddressSearch onPick={flyToCoord} />

      <div className="zoom-indicator" aria-hidden>
        zoom <b>{zoom.toFixed(1)}</b> ·{" "}
        {view === "population" ? (
          <>poseljenost · {popPoints.length.toLocaleString()} točk</>
        ) : showObcineFill ? (
          <>občine · 212 polygons · pop-weighted mean</>
        ) : view === "investor" ? (
          <>
            H3 res <b>{currentRes}</b> · {aggregatedInvestorCells.length.toLocaleString()} hexes
          </>
        ) : (
          <>
            H3 res <b>{currentRes}</b> · {aggregatedScores.length.toLocaleString()} hexes
          </>
        )}
      </div>

      {view === "15min" ? (
        <div className="legend" aria-hidden>
          <h2>15-min skor</h2>
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
      ) : view === "investor" ? (
        <div className="legend" aria-hidden>
          <h2>Investicijski potencial</h2>
          <div className="legend-row">
            <span className="legend-swatch" style={{ background: "rgb(6,182,212)" }} />
            Visok
          </div>
          <div className="legend-row">
            <span className="legend-swatch" style={{ background: "rgb(59,130,246)" }} />
            Srednji
          </div>
          <div className="legend-row">
            <span className="legend-swatch" style={{ background: "rgb(99,102,241)" }} />
            Nizek
          </div>
          <div className="legend-row">
            <span className="legend-swatch" style={{ background: "rgb(139,92,246)" }} />
            Zanemarljiv
          </div>
          <div style={{ fontSize: 11, color: "#888", marginTop: 6 }}>
            Povpraševanje = prebivalci × (1 − skor/8)
          </div>
          {popsLoading && <div style={{ fontSize: 11, color: "#888" }}>nalagam …</div>}
        </div>
      ) : (
        <div className="legend legend-pop" aria-hidden>
          <h2>Poseljenost</h2>
          <div className="legend-gradient" />
          <div className="legend-gradient-labels">
            <span>redko</span>
            <span>pogosto</span>
          </div>
          {popsLoading && <div className="legend-pop-scale">nalagam …</div>}
        </div>
      )}

      {view === "investor" && (
        <div className="investor-cat-filter" role="group" aria-label="Filter kategorije">
          <button
            type="button"
            className={investorCat === null ? "active" : ""}
            onClick={() => setInvestorCat(null)}
          >
            Vse
          </button>
          {CATEGORIES.map((cat, i) => (
            <button
              key={cat.id}
              type="button"
              className={investorCat === i ? "active" : ""}
              onClick={() => setInvestorCat(investorCat === i ? null : i)}
              title={cat.label}
            >
              {cat.icon}
            </button>
          ))}
        </div>
      )}

      {(view === "15min" || view === "investor") && (
        <div className="mode-toggle mode-toggle-global" role="group" aria-label="Način">
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

      <div className="view-switch" role="group" aria-label="Pogled">
        <button
          type="button"
          className={view === "15min" ? "active" : ""}
          onClick={() => setView("15min")}
          aria-pressed={view === "15min"}
        >
          15-min
        </button>
        <button
          type="button"
          className={view === "population" ? "active" : ""}
          onClick={() => setView("population")}
          aria-pressed={view === "population"}
        >
          Poseljenost
        </button>
        <button
          type="button"
          className={view === "investor" ? "active" : ""}
          onClick={() => setView("investor")}
          aria-pressed={view === "investor"}
        >
          Investitor
        </button>
      </div>

      <Scorecard
        h3id={selectedH3}
        mode={mode}
        onClose={() => {
          setSelectedH3(null);
          setHoveredAmenity(null);
        }}
        onIsochrone={setIsoFeature}
        onRoute={setRouteSet}
        onAmenities={(set) => {
          setAmenityDots(set);
          if (!set) setHoveredAmenity(null);
        }}
        onSuggestions={setSuggestionPins}
        onFlyTo={(lat, lng) => mapRef.current?.flyTo({ center: [lng, lat], zoom: 15, duration: 800 })}
      />

      <button
        type="button"
        className="provenance-link"
        onClick={() => setProvenanceOpen(true)}
        aria-label="Od kod podatki?"
      >
        Od kod podatki?
      </button>
      {provenanceOpen && <IzvorPodatkov onClose={() => setProvenanceOpen(false)} />}

      {cellsLoading && (
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
