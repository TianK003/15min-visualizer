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
import AddressSearch, { type AddressSearchHandle } from "@/components/AddressSearch";
import IzvorPodatkov from "@/components/IzvorPodatkov";
import { categoryById } from "@/lib/categories";
import type { AmenityForPoint } from "@/lib/supabase";

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
            // Tile click drops any address anchor — route from cell centroid.
            setOriginLngLat(null);
            setOriginFromAddress(false);
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

    // Origin marker (🏠) — shown whenever paths to amenities are active, so
    // the user can see exactly where the paths start from. Position is the
    // address point if available, else the cell centroid.
    if (selectedH3 && routeSet && routeSet.paths.length > 0) {
      const [oLat, oLng] = originLngLat
        ? [originLngLat[1], originLngLat[0]]
        : h3.cellToLatLng(selectedH3);
      const originPos: [number, number] = [oLng, oLat];
      layers.push(
        new ScatterplotLayer<{ position: [number, number] }>({
          id: "origin-pin-bg",
          data: [{ position: originPos }],
          getPosition: (d) => d.position,
          getFillColor: [14, 165, 233, 240], // sky-500
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
  }, [aggregatedScores, popPoints, showObcineFill, currentRes, view, isoFeature, routeSet, amenityDots, hoveredAmenity, mode, selectedH3, originLngLat]);

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

      <div className="zoom-indicator" aria-hidden>
        zoom <b>{zoom.toFixed(1)}</b> ·{" "}
        {view === "population" ? (
          <>poseljenost · {popPoints.length.toLocaleString()} točk</>
        ) : showObcineFill ? (
          <>občine · 212 polygons · pop-weighted mean</>
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
