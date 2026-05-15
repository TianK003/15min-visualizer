"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer } from "@deck.gl/core";
import { GeoJsonLayer, TextLayer, ScatterplotLayer } from "@deck.gl/layers";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import { H3HexagonLayer, TripsLayer } from "@deck.gl/geo-layers";
import { H3GradientMeshLayer } from "@/lib/H3GradientMeshLayer";
import { buildGradientMesh } from "@/lib/gradientMesh";
import * as h3 from "h3-js";
import Scorecard, { type RouteSet, type RoutePath } from "@/components/Scorecard";
import AddressSearch, { type AddressSearchHandle } from "@/components/AddressSearch";
import IzvorPodatkov from "@/components/IzvorPodatkov";
import ChatBox from "@/components/ChatBox";
import ThemeToggle from "@/components/ThemeToggle";
import { categoryById } from "@/lib/categories";
import type { AmenityForPoint } from "@/lib/supabase";
import { useTheme } from "@/lib/theme";
import { pointInFeature } from "@/lib/geo";

// Path color is derived per-render from the active category (see layers effect).
// α 0.6 (153/255) keeps the path readable while letting the basemap show through.
const PATH_ALPHA = 153;
const FALLBACK_RGB: [number, number, number] = [120, 120, 120];
const DOT_HALO: [number, number, number, number] = [255, 255, 255, 230];

// Liberty is the OSM-Mapnik-flavoured OpenFreeMap style: full street network
// with names from medium zoom, city / town / country labels, POIs. It ships
// with a `building-3d` fill-extrusion layer and a parking POI symbol — we
// strip 3D (map is locked flat) and parking ("P" icons) on style.load.
const BASEMAP_LIGHT = "https://tiles.openfreemap.org/styles/liberty";
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

type View = "15min" | "population";
export type Mode = "walk" | "bike";

/** Score JSON shape: {h3, w, b} — walk & bike scores baked together. */
type ScoreCell = { h3: string; w: number; b: number };
type PopCell = { h3: string; pop: number };
type PopPoint = { position: [number, number]; pop: number };

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

type Rgba = [number, number, number, number];

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

// 2.5 ms per meter caps a 1.2 km walking path at exactly 3 s, the user's
// stated ceiling. Closer amenities animate faster — the spread effect is
// visibly distance-driven.
const MS_PER_METER = 2.5;
const MAX_ANIM_MS = 3000;

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
  // Cached obcine polygons for the top-left "Občina pod kazalcem" indicator.
  // Same URL the deck.gl GeoJsonLayer already fetches; fetched a second time
  // here so we can run cheap point-in-polygon against the map center on
  // every moveend. 212 polygons × brute force ≈ sub-millisecond.
  const [obcineFC, setObcineFC] = useState<GeoJSON.FeatureCollection | null>(null);
  const [obcinaUnderCursor, setObcinaUnderCursor] = useState<string | null>(null);
  // Path-spread animation. currentTime advances via requestAnimationFrame
  // from 0 → maxDuration each time a new routeSet lands. TripsLayer fades
  // segments older than `currentTime - trailLength`; with trailLength = 1e9
  // every revealed segment stays visible permanently.
  const [animTime, setAnimTime] = useState(0);

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

  // One-shot fetch of obcine polygons for the top-left indicator. Failure
  // is non-fatal — the indicator falls back to "Slovenija".
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(OBCINE_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const fc = (await res.json()) as GeoJSON.FeatureCollection;
        if (!cancelled) setObcineFC(fc);
      } catch {
        // Silent — top-left chip will just stay at "Slovenija".
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Lazy-load population on first switch. Deps deliberately omit popsLoading.
  useEffect(() => {
    if (view !== "population" || pops.length > 0) return;
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

  // Swap basemap when theme flips. MapboxOverlay (deck.gl/mapbox v9+) survives
  // setStyle without re-attachment — deck layers persist as the new sprites
  // and source tiles load.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const target = theme === "dark" ? BASEMAP_DARK : BASEMAP_LIGHT;
    map.setStyle(target);
  }, [theme]);

  // Re-identify the obcina under the map center on every moveend. Runs once
  // when the FC finishes loading and after every pan/zoom. Brute force is
  // fine for 212 polygons.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !obcineFC) return;
    const recompute = () => {
      const c = map.getCenter();
      const hit = obcineFC.features.find((f) => pointInFeature(c.lng, c.lat, f));
      const name = (hit?.properties as { OB_UIME?: string } | undefined)?.OB_UIME ?? null;
      setObcinaUnderCursor(name);
    };
    recompute();
    map.on("moveend", recompute);
    return () => {
      map.off("moveend", recompute);
    };
  }, [obcineFC]);

  const showObcineFill = zoom < SHOW_OBCINE_FILL_BELOW;
  const currentRes = zoomToResolution(zoom);

  const aggregatedScores = useMemo(
    () => (showObcineFill ? [] : aggregateMean(cells, currentRes)),
    [cells, currentRes, showObcineFill],
  );

  const gradientMesh = useMemo(
    () =>
      !showObcineFill && view === "15min"
        ? buildGradientMesh(aggregatedScores, mode)
        : { positions: new Float32Array(), colors: new Uint8Array(), vertexCount: 0 },
    [aggregatedScores, mode, showObcineFill, view],
  );

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

  const popPoints = useMemo<PopPoint[]>(() => {
    if (pops.length === 0) return [];
    const out: PopPoint[] = new Array(pops.length);
    for (let i = 0; i < pops.length; i++) {
      const [lat, lng] = h3.cellToLatLng(pops[i].h3);
      out[i] = { position: [lng, lat], pop: pops[i].pop };
    }
    return out;
  }, [pops]);

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
        new H3GradientMeshLayer({
          id: "scores-gradient",
          positions: gradientMesh.positions,
          colors: gradientMesh.colors,
          vertexCount: gradientMesh.vertexCount,
          pickable: false,
        }),
        new H3HexagonLayer<ScoreCell>({
          id: "scores-pick",
          data: aggregatedScores,
          pickable: true,
          stroked: false,
          // filled: true is required — deck.gl needs the polygon for picking
          // geometry even though we make it transparent below.
          filled: true,
          extruded: false,
          getHexagon: (d) => d.h3,
          // Invisible — picking pass uses picking IDs, not fill alpha.
          getFillColor: [0, 0, 0, 0],
          onClick: ({ object }) => {
            if (!object) return;
            // Convert aggregated h3 to a representative res-10 child for
            // scorecard fetch; if already res-10 use as-is.
            const target =
              h3.getResolution(object.h3) >= H3_BASE_RES
                ? object.h3
                : h3.cellToChildren(object.h3, H3_BASE_RES)[0];
            // Tile click drops any address anchor — route from cell centroid.
            setOriginLngLat(null);
            setOriginFromAddress(false);
            setSelectedH3(target);
          },
        }),
      );

      // Selected-cell highlight: a second H3HexagonLayer painted on top of
      // the score layer with full-alpha fill + thick dark border so the
      // user can pick the clicked cell out of the heatmap at a glance.
      // Rendered at the *current aggregated resolution*, not res-10, so it
      // visually matches the surrounding score cells.
      if (selectedH3) {
        const parent = h3.cellToParent(selectedH3, currentRes);
        const matchingScore = aggregatedScores.find((c) => c.h3 === parent);
        const score = matchingScore
          ? (mode === "bike" ? matchingScore.b : matchingScore.w)
          : 4;
        const [hr, hg, hb] = colorForScore(score);
        layers.push(
          new H3HexagonLayer<{ h3: string }>({
            id: "selected-hex",
            data: [{ h3: parent }],
            getHexagon: (d) => d.h3,
            stroked: true,
            filled: true,
            extruded: false,
            getFillColor: [hr, hg, hb, 220],
            getLineColor: [17, 24, 39, 255],
            getLineWidth: 2.5,
            lineWidthUnits: "pixels",
            lineWidthMinPixels: 2.5,
            pickable: false,
            updateTriggers: { getFillColor: [score] },
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
          // Huge trail so segments never fade after being revealed — once
          // the head reaches the amenity, the entire trail stays painted.
          trailLength: 1e9,
          getWidth: 4,
          widthUnits: "pixels",
          widthMinPixels: 3,
          jointRounded: true,
          capRounded: true,
          pickable: false,
          updateTriggers: { getColor: [routeSet.categoryId] },
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

    // Origin marker (🏠) — shown whenever paths to amenities are active, so
    // the user can see exactly where the paths start from. Position is the
    // address point if available, else the cell centroid. The disc is tinted
    // by the active category so the home matches the trail color at a glance.
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
        new TextLayer<{ position: [number, number] }>({
          id: "origin-pin",
          data: [{ position: originPos }],
          getText: () => "🏠",
          getPosition: (d) => d.position,
          getSize: 18,
          getAlignmentBaseline: "center",
          getTextAnchor: "middle",
          characterSet: "auto",
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

    overlay.setProps({ layers });
  }, [aggregatedScores, gradientMesh, popPoints, showObcineFill, currentRes, view, isoFeature, routeSet, amenityDots, hoveredAmenity, mode, selectedH3, originLngLat, animatedPaths, animTime]);

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

      <AddressSearch
        ref={addressSearchRef}
        onPick={(lng, lat) => flyToCoord(lng, lat, 14, true)}
      />

      <div className="obcina-indicator" role="status" aria-live="polite">
        <span className="obcina-pin" aria-hidden>📍</span>
        Občina: <b>{obcinaUnderCursor ?? "Slovenija"}</b>
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
        <div className={`legend legend-pop ${legendOpen ? "is-open" : "is-collapsed"}`}>
          <button
            type="button"
            className="legend-toggle"
            onClick={() => setLegendOpen((o) => !o)}
            aria-expanded={legendOpen}
            aria-controls="legend-body"
          >
            <span>Legenda gostote</span>
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
              <div className="legend-gradient" />
              <div className="legend-gradient-labels">
                <span>redko</span>
                <span>pogosto</span>
              </div>
              {popsLoading && <div className="legend-pop-scale">nalagam …</div>}
            </div>
          )}
        </div>
      )}

      {view === "15min" && (
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
      </div>

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
          className="provenance-link"
          onClick={() => setProvenanceOpen(true)}
          aria-label="Od kod podatki?"
          title="Od kod podatki?"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </button>
      </div>
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
