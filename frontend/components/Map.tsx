"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer } from "@deck.gl/core";
import { GeoJsonLayer } from "@deck.gl/layers";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import * as h3 from "h3-js";
import Scorecard from "@/components/Scorecard";
import AddressSearch from "@/components/AddressSearch";
import IzvorPodatkov from "@/components/IzvorPodatkov";
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

type ScoreCell = { h3: string; score: number };
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
  const groups = new Map<string, { sum: number; count: number }>();
  for (const c of cells) {
    const parent = h3.cellToParent(c.h3, targetRes);
    const g = groups.get(parent);
    if (g) {
      g.sum += c.score;
      g.count += 1;
    } else {
      groups.set(parent, { sum: c.score, count: 1 });
    }
  }
  const out: ScoreCell[] = [];
  groups.forEach((g, hex) => out.push({ h3: hex, score: g.sum / g.count }));
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
  return cells.map((c) => ({ h3: c, score: Math.floor(Math.random() * 9) }));
}

type ObcinaProps = {
  OB_UIME?: string;
  POV_KM2?: number;
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
  const [provenanceOpen, setProvenanceOpen] = useState(false);

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
          getFillColor: (f) => colorForScore(f.properties?.mean_score ?? 0),
          getLineColor: [60, 60, 60, 200],
          lineWidthMinPixels: 1,
          pickable: false,
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
          stroked: currentRes < 9,
          filled: true,
          extruded: false,
          getHexagon: (d) => d.h3,
          getFillColor: (d) => colorForScore(d.score),
          getLineColor: [255, 255, 255, 200],
          lineWidthUnits: "pixels",
          getLineWidth: 1,
          updateTriggers: { getFillColor: aggregatedScores },
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

    overlay.setProps({ layers });
  }, [aggregatedScores, popPoints, showObcineFill, currentRes, view, isoFeature]);

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
        onClose={() => setSelectedH3(null)}
        onIsochrone={setIsoFeature}
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
