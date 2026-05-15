"use client";

import { useEffect, useRef, useState } from "react";

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: { name?: string; city?: string; street?: string; housenumber?: string; postcode?: string; country?: string; state?: string };
};

const PHOTON = "https://photon.komoot.io/api";
// Constrain to SI bbox (lng_min, lat_min, lng_max, lat_max).
const SI_BBOX = "13.3,45.4,16.7,46.9";

type Props = {
  onPick: (lng: number, lat: number) => void;
};

export default function AddressSearch({ onPick }: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PhotonFeature[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Debounced Photon fetch
  useEffect(() => {
    if (q.trim().length < 3) {
      setResults([]);
      setErr(null);
      return;
    }
    const handle = setTimeout(() => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);
      // Photon doesn't support "sl" — accepts en/de/fr/it/ja. Use default (no lang).
      fetch(`${PHOTON}/?q=${encodeURIComponent(q)}&bbox=${SI_BBOX}&limit=6`, {
        signal: ac.signal,
      })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((data: { features: PhotonFeature[] }) => {
          setResults(data.features || []);
          setErr(null);
        })
        .catch((e) => {
          if (e?.name !== "AbortError") setErr("Photon nedostopen");
        })
        .finally(() => setLoading(false));
    }, 220);
    return () => clearTimeout(handle);
  }, [q]);

  // Click-outside closes the dropdown.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const select = (f: PhotonFeature) => {
    const [lng, lat] = f.geometry.coordinates;
    onPick(lng, lat);
    setOpen(false);
    setQ(labelFor(f));
  };

  const onPasteLatLng = () => {
    // Free-form `lat,lng` paste fallback.
    const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m) {
      onPick(parseFloat(m[2]), parseFloat(m[1]));
      setOpen(false);
    }
  };

  return (
    <div className="address-search" ref={wrapRef}>
      <input
        type="search"
        placeholder="Vpišite svoj naslov …"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (results.length > 0) select(results[0]);
            else onPasteLatLng();
          }
          if (e.key === "Escape") setOpen(false);
        }}
        aria-label="Iskanje naslova"
      />
      {open && (results.length > 0 || loading || err) && (
        <div className="address-dropdown" role="listbox">
          {loading && <div className="address-status">iščem …</div>}
          {err && <div className="address-status error">{err}</div>}
          {results.map((r, i) => (
            <button
              type="button"
              key={i}
              className="address-result"
              onClick={() => select(r)}
              role="option"
            >
              {labelFor(r)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function labelFor(f: PhotonFeature): string {
  const p = f.properties;
  const street = [p.street, p.housenumber].filter(Boolean).join(" ");
  const city = [p.postcode, p.city].filter(Boolean).join(" ");
  return [p.name, street, city].filter(Boolean).join(", ");
}
