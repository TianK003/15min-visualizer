"use client";

import { useEffect, useState } from "react";
import * as h3 from "h3-js";
import { cellScore, amenitiesForPoint, type CellScoreRow, type AmenityForPoint } from "@/lib/supabase";
import { isochrone, route } from "@/lib/valhalla";
import { CATEGORIES, type CategoryId } from "@/lib/categories";
import { decodePolyline } from "@/lib/polyline";

export type RoutePath = {
  shape: [number, number][];
  end: { lat: number; lng: number; name: string };
};

export type RouteSet = {
  categoryId: CategoryId;
  paths: RoutePath[];
};

type Mode = "walk" | "bike";

type Props = {
  h3id: string | null;
  mode: Mode;
  onModeChange: (m: Mode) => void;
  onClose: () => void;
  onIsochrone: (poly: GeoJSON.Feature | null) => void;
  onRoute: (set: RouteSet | null) => void;
  onAmenities: (amenities: AmenityForPoint[] | null) => void;
};

type IsoPair = { walk: GeoJSON.Feature | null; bike: GeoJSON.Feature | null };
type AmenityByMode = { walk: AmenityForPoint[]; bike: AmenityForPoint[] };

const EMPTY_AMENITIES: AmenityByMode = { walk: [], bike: [] };

/** Cap on simultaneous routes per category click. */
const MAX_PATHS_PER_CATEGORY = 25;

export default function Scorecard({
  h3id, mode, onModeChange, onClose, onIsochrone, onRoute, onAmenities,
}: Props) {
  const [cell, setCell] = useState<CellScoreRow | null>(null);
  const [amenities, setAmenities] = useState<AmenityByMode>(EMPTY_AMENITIES);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isos, setIsos] = useState<IsoPair>({ walk: null, bike: null });
  const [isoFetched, setIsoFetched] = useState(false);
  const [isoVisible, setIsoVisible] = useState(false);
  const [isoLoading, setIsoLoading] = useState(false);
  const [activeCat, setActiveCat] = useState<CategoryId | null>(null);
  const [routeLoading, setRouteLoading] = useState<CategoryId | null>(null);

  // Fetch cell + both amenity sets whenever the selected h3 changes.
  useEffect(() => {
    if (!h3id) {
      setCell(null);
      setAmenities(EMPTY_AMENITIES);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [lat, lng] = h3.cellToLatLng(h3id);
        const [c, walkAm, bikeAm] = await Promise.all([
          cellScore(h3id),
          amenitiesForPoint(lat, lng, "pedestrian").catch(() => [] as AmenityForPoint[]),
          amenitiesForPoint(lat, lng, "bicycle").catch(() => [] as AmenityForPoint[]),
        ]);
        if (!cancelled) {
          setCell(c);
          setAmenities({ walk: walkAm, bike: bikeAm });
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : "Napaka";
          setError(msg.includes("PGRST116") ? "Ta celica nima podatkov." : msg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [h3id]);

  // Reset all isochrone/route state when the cell changes. Deps intentionally
  // exclude the callbacks — they're inline in the parent and would recreate
  // on every render, retriggering this effect and clobbering isoVisible.
  useEffect(() => {
    setIsos({ walk: null, bike: null });
    setIsoFetched(false);
    setIsoVisible(false);
    setActiveCat(null);
    onIsochrone(null);
    onRoute(null);
    onAmenities(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h3id]);

  // Mode toggle: re-publish active polygon + amenities + re-fetch active route.
  useEffect(() => {
    if (!h3id) return;
    onIsochrone(isoVisible ? isos[mode] : null);
    onAmenities(isoVisible ? amenities[mode] : null);
    if (activeCat) void fetchRoutesForCategory(activeCat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Whenever isos / visibility / amenity sets land, sync to parent.
  useEffect(() => {
    onIsochrone(isoVisible ? isos[mode] : null);
    onAmenities(isoVisible ? amenities[mode] : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isos, isoVisible, amenities]);

  const toggleIsochrones = async () => {
    if (!h3id) return;
    if (isoFetched) {
      // Already fetched — flip visibility, no network.
      setIsoVisible((v) => !v);
      return;
    }
    setIsoLoading(true);
    try {
      const [lat, lng] = h3.cellToLatLng(h3id);
      const [walk, bike] = await Promise.all([
        isochrone({ lat, lng, minutes: 15, costing: "pedestrian" }),
        isochrone({ lat, lng, minutes: 15, costing: "bicycle" }),
      ]);
      setIsos({ walk, bike });
      setIsoFetched(true);
      setIsoVisible(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Valhalla nedostopen");
    } finally {
      setIsoLoading(false);
    }
  };

  const fetchRoutesForCategory = async (cat: CategoryId) => {
    if (!h3id) return;
    const activeAmenities = amenities[mode];
    if (activeAmenities.length === 0) return;
    const targets = activeAmenities.filter((a) => a.category === cat).slice(0, MAX_PATHS_PER_CATEGORY);
    if (targets.length === 0) return;
    const [lat, lng] = h3.cellToLatLng(h3id);
    const costing = mode === "bike" ? "bicycle" : "pedestrian";
    setRouteLoading(cat);
    try {
      const results = await Promise.allSettled(
        targets.map((t) =>
          route({ from: { lat, lng }, to: { lat: t.lat, lng: t.lng }, costing }).then(
            (r) => ({ t, shape: r.trip.legs[0]?.shape }),
          ),
        ),
      );
      const paths: RoutePath[] = [];
      for (const r of results) {
        if (r.status !== "fulfilled" || !r.value.shape) continue;
        paths.push({
          shape: decodePolyline(r.value.shape),
          end: {
            lat: r.value.t.lat,
            lng: r.value.t.lng,
            name: r.value.t.name ?? r.value.t.category,
          },
        });
      }
      if (paths.length === 0) throw new Error("ni dosegljivih lokacij");
      onRoute({ categoryId: cat, paths });
      setActiveCat(cat);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pot ni mogoča");
    } finally {
      setRouteLoading(null);
    }
  };

  const onRowClick = (cat: CategoryId, reachable: boolean) => {
    if (!reachable) return;
    if (activeCat === cat) {
      setActiveCat(null);
      onRoute(null);
      return;
    }
    void fetchRoutesForCategory(cat);
  };

  if (!h3id) return null;

  const isoLabel = mode === "bike" ? "(15 min kolesa)" : "(15 min hoje)";
  const buttonText = isoLoading
    ? "Računam …"
    : isoVisible
      ? "Skrij dosegljivost"
      : `Prikaži dosegljivost ${isoLabel}`;
  const displayScore = cell ? (mode === "bike" ? cell.bike_score : cell.walk_score) : 0;
  const displayBucket = bucketFor(displayScore);
  const activeAmenities = amenities[mode];

  return (
    <aside className="scorecard" role="dialog" aria-label="Skor celice">
      <button className="scorecard-close" onClick={onClose} aria-label="Zapri">×</button>
      {loading && <div className="scorecard-loading">Nalagam …</div>}
      {error && <div className="scorecard-error">{error}</div>}

      {cell && (
        <>
          <div className="scorecard-header">
            <div className="big-score" data-bucket={displayBucket}>
              {displayScore}
              <span className="of">/8</span>
            </div>
            <div className="scorecard-sub">
              {mode === "bike" ? "15-min skor (kolo)" : "15-min skor (hoja)"}
              <br />
              <code>{h3id.slice(0, 10)}…</code>
              {cell.population != null && (
                <> · {Math.round(cell.population * 100) / 100} prebivalcev</>
              )}
            </div>
          </div>

          <div className="scorecard-rows">
            {CATEGORIES.map((c, i) => {
              const walkVal = cell.walk_min[i];
              const bikeVal = cell.bike_min[i];
              const val = mode === "walk" ? walkVal : bikeVal;
              const reachable = val !== null;
              const isActive = activeCat === c.id;
              const isLoading = routeLoading === c.id;
              return (
                <button
                  type="button"
                  key={c.id}
                  className={`scorecard-row ${reachable ? "ok" : "miss"} ${isActive ? "active" : ""}`}
                  onClick={() => onRowClick(c.id, reachable)}
                  disabled={!reachable}
                  aria-pressed={isActive}
                  data-cat={c.id}
                >
                  <span className="ico" aria-hidden>{c.icon}</span>
                  <span className="cat">{c.label}</span>
                  <span className="check" aria-label={reachable ? "dosegljivo" : "nedosegljivo"}>
                    {isLoading ? "…" : reachable ? "✓" : "—"}
                  </span>
                  <span className="time">{val !== null ? `${val} min` : ""}</span>
                </button>
              );
            })}
          </div>

          <div className="mode-toggle" role="group" aria-label="Način">
            <button
              type="button"
              className={mode === "walk" ? "active" : ""}
              onClick={() => onModeChange("walk")}
              aria-pressed={mode === "walk"}
            >
              Hoja
            </button>
            <button
              type="button"
              className={mode === "bike" ? "active" : ""}
              onClick={() => onModeChange("bike")}
              aria-pressed={mode === "bike"}
            >
              Kolo
            </button>
          </div>

          <button
            type="button"
            className={`iso-btn ${isoVisible ? "iso-btn-hide" : ""}`}
            onClick={toggleIsochrones}
            disabled={isoLoading}
          >
            {buttonText}
          </button>

          {activeAmenities.length > 0 && (
            <details className="amenities-detail">
              <summary>{activeAmenities.length} dosegljivih lokacij</summary>
              <ul className="amenities-list">
                {activeAmenities.slice(0, 25).map((a) => (
                  <li key={a.amenity_id}>
                    <span className="dot" data-cat={a.category} />
                    <span className="name">{a.name ?? a.category}</span>
                    <span className="t">{a.walk_min} min</span>
                  </li>
                ))}
                {activeAmenities.length > 25 && (
                  <li className="more">… in {activeAmenities.length - 25} več</li>
                )}
              </ul>
            </details>
          )}
        </>
      )}
    </aside>
  );
}

function bucketFor(score: number): string {
  if (score >= 6) return "green";
  if (score >= 4) return "yellow";
  if (score >= 2) return "orange";
  return "red";
}
