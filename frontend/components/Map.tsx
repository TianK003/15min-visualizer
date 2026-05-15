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

const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
const OBCINE_URL = "/data/obcine_scored.geojson";
const SCORES_URL = "/data/cell_scores_lite.json";
const POPULATION_URL = "/data/cell_population_lite.json";

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

// Map viewport zoom → H3 aggregation resolution.
// Only consulted at zoom ≥ SHOW_OBCINE_FILL_BELOW; below that, the občina layer takes over.
function zoomToResolution(zoom: number): number {
  if (zoom < 10) return 6;  // ~450 hexes — smooth handoff from občine
  if (zoom < 11) return 7;  // ~3k mid hexes (region)
  if (zoom < 13) return 8;  // ~22k hexes (city)
  if (zoom < 15) return 9;  // ~154k district/street
  return 10;                // ~1.08M raw (house-block, 66m edge)
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
  groups.forEach((g, h) => out.push({ h3: h, score: g.sum / g.count }));
  return out;
}

type Rgba = [number, number, number, number];

function colorForScore(score: number): Rgba {
  if (score >= 6) return [16, 185, 129, 128];
  if (score >= 4) return [234, 179, 8, 128];
  if (score >= 2) return [249, 115, 22, 128];
  return [239, 68, 68, 128];
}

// Magma palette used by the HeatmapLayer's colorRange. RGB triples only
// (HeatmapLayer applies its own alpha based on density).
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

export default function SloveniaMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);

  const [view, setView] = useState<View>("15min");
  const [cells, setCells] = useState<ScoreCell[]>([]);
  const [pops, setPops] = useState<PopCell[]>([]);
  const [popsLoading, setPopsLoading] = useState(false);
  const [zoom, setZoom] = useState<number>(INITIAL_ZOOM);
  const [usingDummy, setUsingDummy] = useState<boolean>(false);

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
          // eslint-disable-next-line no-console
          console.log(`Loaded ${data.length.toLocaleString()} real cells`);
        }
      } catch (err) {
        if (!cancelled) {
          // eslint-disable-next-line no-console
          console.warn("Falling back to dummy hexes:", err);
          setCells(generateDummyCells());
          setUsingDummy(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Lazy-load the population layer the first time the user switches to it.
  // Deps deliberately exclude `popsLoading` — including it caused React to
  // tear down the effect (and flip `cancelled = true`) the moment we called
  // setPopsLoading(true), aborting our own in-flight fetch.
  useEffect(() => {
    if (view !== "population" || pops.length > 0) return;
    let cancelled = false;
    setPopsLoading(true);
    (async () => {
      try {
        const res = await fetch(POPULATION_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: PopCell[] = await res.json();
        if (!cancelled) {
          setPops(data);
          // eslint-disable-next-line no-console
          console.log(`Loaded ${data.length.toLocaleString()} population cells`);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("Population layer fetch failed:", err);
      } finally {
        if (!cancelled) setPopsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view, pops.length]);

  // Initialize map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      center: SLOVENIA_CENTER,
      zoom: INITIAL_ZOOM,
    });
    mapRef.current = map;

    const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
    overlayRef.current = overlay;
    map.addControl(overlay as unknown as maplibregl.IControl);

    const onZoom = () => setZoom(map.getZoom());
    map.on("zoom", onZoom);

    return () => {
      map.off("zoom", onZoom);
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, []);

  const showObcineFill = zoom < SHOW_OBCINE_FILL_BELOW;
  const currentRes = zoomToResolution(zoom);

  // Skip the score-hex aggregation while we're in občina mode.
  const aggregatedScores = useMemo(
    () => (showObcineFill ? [] : aggregateMean(cells, currentRes)),
    [cells, currentRes, showObcineFill],
  );

  // Convert H3 cells → centroid points once. HeatmapLayer eats points + weights
  // and does Gaussian density smoothing on the GPU.
  const popPoints = useMemo<PopPoint[]>(() => {
    if (pops.length === 0) return [];
    const out: PopPoint[] = new Array(pops.length);
    for (let i = 0; i < pops.length; i++) {
      const [lat, lng] = h3.cellToLatLng(pops[i].h3);
      out[i] = { position: [lng, lat], pop: pops[i].pop };
    }
    return out;
  }, [pops]);

  // Push layers whenever data or mode changes.
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    const layers: Layer[] = [];

    if (view === "population") {
      // Single soft heatmap at every zoom — kernel size is in screen pixels,
      // so it auto-adapts. No občina fill, no hex outlines, no picking.
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
          pickable: true,
          onClick: ({ object }) => {
            const p: ObcinaProps | undefined = (object as { properties?: ObcinaProps } | null)?.properties;
            if (p) {
              // eslint-disable-next-line no-console
              console.log(
                `${p.OB_UIME}: mean_score=${p.mean_score}, population=${p.population?.toLocaleString()}, cells=${p.n_cells}`,
              );
            }
          },
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
          // Drop outlines + hover picking once cell counts get heavy (res ≥ 9 ≈ zoom ≥ 13).
          pickable: currentRes < 9,
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
            if (object) {
              // eslint-disable-next-line no-console
              console.log("hex click:", object.h3, "score:", object.score);
            }
          },
        }),
      );
    }

    overlay.setProps({ layers });
  }, [aggregatedScores, popPoints, showObcineFill, currentRes, view]);

  return (
    <>
      <div id="map-root" ref={containerRef} />

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
          {popsLoading && (
            <div className="legend-pop-scale">nalagam …</div>
          )}
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

      {usingDummy && (
        <div className="banner">
          Showing dummy Ljubljana hexes — bake not yet complete. Refresh once
          <code> cell_scores_lite.json </code>
          lands.
        </div>
      )}
    </>
  );
}
