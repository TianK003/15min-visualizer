"use client";

import { CATEGORIES, type CategoryId } from "@/lib/categories";

type Mode = "walk" | "bike";

export type ObcinaInfo = {
  OB_UIME?: string;
  population?: number;
  POV_KM2?: number;
  walk_mean?: number;
  bike_mean?: number;
  walk_missing?: Partial<Record<CategoryId, number>>;
  bike_missing?: Partial<Record<CategoryId, number>>;
};

type Props = {
  obcina: ObcinaInfo;
  mode: Mode;
  onClose: () => void;
};

function bucketFor(score: number): "green" | "yellow" | "orange" | "red" {
  if (score >= 6) return "green";
  if (score >= 4) return "yellow";
  if (score >= 2) return "orange";
  return "red";
}

// Inverse of bucketFor — higher missing share = worse, so we map onto the
// same palette but flipped: 0–0.25 green, 0.25–0.5 yellow, 0.5–0.75 orange,
// 0.75+ red. Keeps the visual vocabulary consistent with the Scorecard.
function missingBucket(share: number): "green" | "yellow" | "orange" | "red" {
  if (share >= 0.75) return "red";
  if (share >= 0.50) return "orange";
  if (share >= 0.25) return "yellow";
  return "green";
}

function formatPct(v: number | undefined | null): string {
  if (v === undefined || v === null || Number.isNaN(v)) return "—";
  return `${Math.round(v * 100)}%`;
}

function formatInt(v: number | undefined | null): string {
  if (v === undefined || v === null) return "—";
  return Math.round(v).toLocaleString("sl-SI");
}

export default function ObcinaInfoCard({ obcina, mode, onClose }: Props) {
  const score = mode === "bike" ? obcina.bike_mean ?? 0 : obcina.walk_mean ?? 0;
  const scoreInt = Math.round(score);
  const bucket = bucketFor(scoreInt);
  const missing = mode === "bike" ? obcina.bike_missing : obcina.walk_missing;
  const area = obcina.POV_KM2;
  const density =
    obcina.population && area && area > 0 ? obcina.population / area : null;

  return (
    <aside className="obcina-card" role="dialog" aria-label="Podatki o občini">
      <button className="obcina-card-close" onClick={onClose} aria-label="Zapri">×</button>

      <div className="obcina-card-header">
        <div className="big-score" data-bucket={bucket}>
          {scoreInt}
          <span className="of">/8</span>
        </div>
        <div className="obcina-card-title">
          <div className="obcina-card-name">{obcina.OB_UIME ?? "Občina"}</div>
        </div>
      </div>

      <dl className="obcina-card-stats">
        <div>
          <dt>Prebivalci</dt>
          <dd>{formatInt(obcina.population)}</dd>
        </div>
        <div>
          <dt>Površina</dt>
          <dd>{area !== undefined ? `${area.toFixed(1)} km²` : "—"}</dd>
        </div>
        <div>
          <dt>Gostota</dt>
          <dd>{density !== null ? `${formatInt(density)}/km²` : "—"}</dd>
        </div>
      </dl>

      <div className="obcina-card-rowtitle">
        Delež prebivalcev brez 15-min dostopa do:
      </div>
      <div className="obcina-card-rows">
        {CATEGORIES.map((c) => {
          const v = missing?.[c.id];
          const has = v !== undefined && v !== null;
          const b = has ? missingBucket(v as number) : "green";
          return (
            <div key={c.id} className="obcina-card-row" data-bucket={b}>
              <span className="ico" aria-hidden>
                <svg viewBox="0 0 24 24" fill="currentColor"><path d={c.iconPath} /></svg>
              </span>
              <span className="cat">{c.label}</span>
              <span className="pct">{formatPct(v)}</span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
