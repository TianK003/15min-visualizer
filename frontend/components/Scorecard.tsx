"use client";

import { useEffect, useMemo, useState } from "react";
import * as h3 from "h3-js";
import { cellScore, amenitiesForPoint, type CellScoreRow, type AmenityForPoint } from "@/lib/supabase";
import { isochrone, route } from "@/lib/valhalla";
import { CATEGORIES, type CategoryId } from "@/lib/categories";
import { decodePolyline } from "@/lib/polyline";
import { pointInFeature } from "@/lib/geo";

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
  /** Optional override for the routing origin. When set (e.g. from address
   *  search) the iso/amenity/route fetches use this exact point instead of
   *  the H3 cell centroid. The score itself remains a cell property. */
  originLngLat?: [number, number] | null;
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

// pointInFeature lives in lib/geo.ts — clip the visible amenity set to the
// user-centered iso polygon so the rendered dots match what the polygon
// visually says is reachable.

export default function Scorecard({
  h3id, mode, originLngLat, onClose, onIsochrone, onRoute, onAmenities,
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
  // Which row's "podrobnosti" expansion is open. At most one at a time —
  // expanding a new row collapses the previous.
  const [expandedCat, setExpandedCat] = useState<CategoryId | null>(null);

  // Routing origin: use the exact address point when provided, otherwise the
  // cell centroid. The score still belongs to the cell (h3id) — only the
  // iso/amenity/route fetches snap to this point.
  const origin = useMemo<[number, number]>(() => {
    if (originLngLat) return [originLngLat[1], originLngLat[0]]; // [lat, lng]
    return h3id ? h3.cellToLatLng(h3id) : [0, 0];
  }, [originLngLat, h3id]);

  // Fetch cell + both amenity sets whenever the selected h3 or origin changes.
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
        const [lat, lng] = origin;
        // Fetch the 15-min isochrone alongside cell + amenity data so the
        // scorecard never renders before the polygon is known. Category
        // clicks downstream filter routes through visibleAmenities, which
        // applies the iso polygon as soon as it's set — guarantees no
        // path is ever drawn to an amenity outside the 15-min envelope.
        const [c, walkAm, bikeAm, walkIso, bikeIso] = await Promise.all([
          cellScore(h3id),
          amenitiesForPoint(lat, lng, "pedestrian").catch(() => [] as AmenityForPoint[]),
          amenitiesForPoint(lat, lng, "bicycle").catch(() => [] as AmenityForPoint[]),
          isochrone({ lat, lng, minutes: 15, costing: "pedestrian" }).catch(() => null),
          isochrone({ lat, lng, minutes: 15, costing: "bicycle" }).catch(() => null),
        ]);
        if (!cancelled) {
          setCell(c);
          setAmenities({ walk: walkAm, bike: bikeAm });
          setIsos({ walk: walkIso, bike: bikeIso });
          setIsoFetched(true);
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
  }, [h3id, origin]);

  // Reset all isochrone/route state when the cell or origin changes. Deps
  // intentionally exclude the callbacks — they're inline in the parent and
  // would recreate on every render, retriggering this effect and clobbering
  // isoVisible.
  useEffect(() => {
    setIsos({ walk: null, bike: null });
    setIsoFetched(false);
    setIsoVisible(false);
    setActiveCat(null);
    onIsochrone(null);
    onRoute(null);
    onAmenities(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h3id, origin]);

  // Auto-dismiss the "ni dosegljivih lokacij" message after 3 s so the
  // scorecard doesn't get stuck showing a Valhalla failure.
  useEffect(() => {
    if (error !== "ni dosegljivih lokacij") return;
    const t = setTimeout(() => setError(null), 3000);
    return () => clearTimeout(t);
  }, [error]);

  // Filter both amenity sets to the user-centered iso polygon so the dots,
  // the <details> list, and the routes drawn on category-click stay in sync
  // with what the polygon visually says is "reachable in 15 min".
  const visibleAmenities = useMemo<AmenityByMode>(() => {
    const filterOne = (set: AmenityForPoint[], iso: GeoJSON.Feature | null) => {
      // Hard 15-min ceiling first so routes never get drawn to amenities the
      // scoreboard / isochrone consider out of range. The polygon filter
      // (when an iso is loaded) tightens this further to the actual reachable
      // footprint, but without it the time filter alone keeps everything in
      // the 15-min envelope.
      const byTime = set.filter((a) => a.walk_min <= 15);
      return iso ? byTime.filter((a) => pointInFeature(a.lng, a.lat, iso)) : byTime;
    };
    return {
      walk: filterOne(amenities.walk, isos.walk),
      bike: filterOne(amenities.bike, isos.bike),
    };
  }, [amenities, isos]);

  // Mode toggle: just re-fetch the active route — iso/amenity publishing is
  // handled by the centralized effect below (which has `mode` in its deps).
  useEffect(() => {
    if (!h3id) return;
    if (activeCat) void fetchRoutesForCategory(activeCat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // What we publish to the map as hoverable amenity dots:
  //   - iso polygon visible  → all amenities within 15 min (every category)
  //   - category route active → ONLY the active category's amenities
  //                              (so hovering a path endpoint reveals its name
  //                               without dropping the whole 15-min polygon on)
  //   - neither              → null (no dots on map)
  // The map applies its own active-category gate on the hover *label*, so
  // dots-only mode never leaks names from other categories.
  const amenitiesForMap = useMemo<AmenityForPoint[] | null>(() => {
    if (isoVisible) return visibleAmenities[mode];
    if (activeCat) return visibleAmenities[mode].filter((a) => a.category === activeCat);
    return null;
  }, [isoVisible, activeCat, visibleAmenities, mode]);

  // Publish iso polygon + amenities to parent.
  useEffect(() => {
    onIsochrone(isoVisible ? isos[mode] : null);
    onAmenities(amenitiesForMap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isos, isoVisible, amenitiesForMap, mode]);

  const toggleIsochrones = async () => {
    if (!h3id) return;
    if (isoFetched) {
      // Already fetched — flip visibility, no network.
      setIsoVisible((v) => !v);
      return;
    }
    setIsoLoading(true);
    try {
      const [lat, lng] = origin;
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
    const activeAmenities = visibleAmenities[mode];
    if (activeAmenities.length === 0) return;
    const targets = activeAmenities.filter((a) => a.category === cat).slice(0, MAX_PATHS_PER_CATEGORY);
    if (targets.length === 0) return;
    const [lat, lng] = origin;
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
              {cell.population != null && (
                <>
                  <br />
                  {Math.round(cell.population * 100) / 100} prebivalcev
                </>
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
              const isExpanded = expandedCat === c.id;
              // Top 10 reachable amenities with a real (non-generic) name —
              // strip those whose name is just the category label (which is
              // what amenitiesForPoint falls back to when OSM has no name).
              const namedAmenities = visibleAmenities[mode]
                .filter((a) => a.category === c.id)
                .filter((a) => a.name && a.name.trim().toLowerCase() !== c.label.toLowerCase())
                .slice(0, 10);
              return (
                <div key={c.id}>
                  <div className="scorecard-row-line">
                    <button
                      type="button"
                      className={`scorecard-row ${reachable ? "ok" : "miss"} ${isActive ? "active" : ""}`}
                      onClick={() => onRowClick(c.id, reachable)}
                      disabled={!reachable}
                      aria-pressed={isActive}
                      data-cat={c.id}
                    >
                      <span className="ico" aria-hidden>
                        <svg viewBox="0 0 24 24" fill="currentColor"><path d={c.iconPath} /></svg>
                      </span>
                      <span className="cat">
                        {c.label}
                        <span className="cat-color" style={{ background: `rgb(${c.color[0]}, ${c.color[1]}, ${c.color[2]})` }} aria-hidden />
                      </span>
                      <span className="check" aria-label={reachable ? "dosegljivo" : "nedosegljivo"}>
                        {isLoading ? "…" : reachable ? "✓" : "—"}
                      </span>
                      <span className="time">{val !== null ? `${val} min` : ""}</span>
                    </button>
                    <button
                      type="button"
                      className={`scorecard-row-toggle ${isExpanded ? "is-open" : ""}`}
                      onClick={() => setExpandedCat(isExpanded ? null : c.id)}
                      aria-expanded={isExpanded}
                      aria-label={isExpanded ? "Skrij podrobnosti" : "Pokaži podrobnosti"}
                      title="Podrobnosti"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                  </div>
                  {isExpanded && (
                    <div className="scorecard-row-detail">
                      <p className="cat-desc">{c.description}</p>
                      {namedAmenities.length > 0 ? (
                        <ol className="cat-amenities">
                          {namedAmenities.map((a) => (
                            <li key={a.amenity_id}>
                              <span className="cat-amenity-name">{a.name}</span>
                              <span className="cat-amenity-t">{a.walk_min} min</span>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="cat-empty">Brez imenovanih lokacij v dosegu.</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button
            type="button"
            className={`iso-btn ${isoVisible ? "iso-btn-hide" : ""}`}
            onClick={toggleIsochrones}
            disabled={isoLoading}
          >
            {buttonText}
          </button>

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
