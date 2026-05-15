"use client";

import { useEffect, useState } from "react";
import * as h3 from "h3-js";
import { cellScore, amenitiesForPoint, type CellScoreRow, type AmenityForPoint } from "@/lib/supabase";
import { isochrone } from "@/lib/valhalla";

const CATS = ["trgovina", "izobrazevanje", "zdravstvo", "park", "promet", "sport", "storitve", "delo"] as const;
const CAT_LABELS = ["Trgovina", "Izobraževanje", "Zdravstvo", "Park", "Javni promet", "Šport", "Storitve", "Delo"];
const CAT_ICONS = ["🛒", "🎓", "⚕️", "🌳", "🚌", "🏟️", "✂️", "💼"];

type Props = {
  h3id: string | null;
  onClose: () => void;
  onIsochrone: (poly: GeoJSON.Feature | null) => void;
};

export default function Scorecard({ h3id, onClose, onIsochrone }: Props) {
  const [cell, setCell] = useState<CellScoreRow | null>(null);
  const [amenities, setAmenities] = useState<AmenityForPoint[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"walk" | "bike">("walk");
  const [isoLoading, setIsoLoading] = useState(false);

  useEffect(() => {
    if (!h3id) {
      setCell(null);
      setAmenities(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [lat, lng] = h3.cellToLatLng(h3id);
        const [c, a] = await Promise.all([
          cellScore(h3id),
          amenitiesForPoint(lat, lng).catch(() => [] as AmenityForPoint[]),
        ]);
        if (!cancelled) {
          setCell(c);
          setAmenities(a);
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

  // Clear isochrone when the panel closes / cell changes.
  useEffect(() => {
    onIsochrone(null);
  }, [h3id, onIsochrone]);

  const showIsochrone = async () => {
    if (!h3id) return;
    setIsoLoading(true);
    try {
      const [lat, lng] = h3.cellToLatLng(h3id);
      // 15 min walk == 6 min bike == 15 min bike at 2.5x → for the polygon we
      // always ask Valhalla for the pedestrian 15-min reach. The bike toggle
      // reuses the same polygon scaled mentally (TASKS C5 lock).
      const poly = await isochrone({ lat, lng, walkMin: 15, costing: "pedestrian" });
      onIsochrone(poly);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Valhalla nedostopen");
    } finally {
      setIsoLoading(false);
    }
  };

  if (!h3id) return null;

  return (
    <aside className="scorecard" role="dialog" aria-label="Skor celice">
      <button className="scorecard-close" onClick={onClose} aria-label="Zapri">×</button>
      {loading && <div className="scorecard-loading">Nalagam …</div>}
      {error && <div className="scorecard-error">{error}</div>}

      {cell && (
        <>
          <div className="scorecard-header">
            <div className="big-score" data-bucket={bucketFor(cell.score)}>
              {cell.score}
              <span className="of">/8</span>
            </div>
            <div className="scorecard-sub">
              15-min skor
              <br />
              <code>{h3id.slice(0, 10)}…</code>
              {cell.population != null && (
                <> · {Math.round(cell.population * 100) / 100} prebivalcev</>
              )}
            </div>
          </div>

          <div className="scorecard-rows">
            {CATS.map((_cat, i) => {
              const walkVal = cell.walk_min[i];
              const bikeVal = cell.bike_min[i];
              const reachable = walkVal !== null;
              const val = mode === "walk" ? walkVal : bikeVal;
              return (
                <div key={i} className={`scorecard-row ${reachable ? "ok" : "miss"}`}>
                  <span className="ico" aria-hidden>{CAT_ICONS[i]}</span>
                  <span className="cat">{CAT_LABELS[i]}</span>
                  <span className="check" aria-label={reachable ? "dosegljivo" : "nedosegljivo"}>
                    {reachable ? "✓" : "—"}
                  </span>
                  <span className="time">{val !== null ? `${val} min` : ""}</span>
                </div>
              );
            })}
          </div>

          <div className="mode-toggle" role="group" aria-label="Način">
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

          <button
            type="button"
            className="iso-btn"
            onClick={showIsochrone}
            disabled={isoLoading}
          >
            {isoLoading ? "Računam …" : "Prikaži dosegljivost (15 min hoje)"}
          </button>

          {amenities && amenities.length > 0 && (
            <details className="amenities-detail">
              <summary>{amenities.length} dosegljivih lokacij</summary>
              <ul className="amenities-list">
                {amenities.slice(0, 25).map((a) => (
                  <li key={a.amenity_id}>
                    <span className="dot" data-cat={a.category} />
                    <span className="name">{a.name ?? a.category}</span>
                    <span className="t">{a.walk_min} min</span>
                  </li>
                ))}
                {amenities.length > 25 && (
                  <li className="more">… in {amenities.length - 25} več</li>
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
