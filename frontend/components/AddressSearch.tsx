"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export type AddressSearchHandle = {
  clear: () => void;
};

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: { name?: string; city?: string; street?: string; housenumber?: string; postcode?: string; country?: string; state?: string };
};

const PHOTON = "https://photon.komoot.io/api";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
// Constrain to SI bbox (lng_min, lat_min, lng_max, lat_max).
const SI_BBOX = "13.3,45.4,16.7,46.9";
// Nominatim viewbox uses x1,y1,x2,y2 = west_lng, north_lat, east_lng, south_lat.
const SI_VIEWBOX = "13.3,46.9,16.7,45.4";
const MIN_QUERY = 5;

type NominatimResult = {
  lat: string;
  lon: string;
  display_name?: string;
  name?: string;
  address?: {
    road?: string;
    house_number?: string;
    city?: string;
    town?: string;
    village?: string;
    hamlet?: string;
    suburb?: string;
    postcode?: string;
    country?: string;
    state?: string;
  };
};

function nominatimToFeature(n: NominatimResult): PhotonFeature {
  const a = n.address ?? {};
  return {
    geometry: { coordinates: [parseFloat(n.lon), parseFloat(n.lat)] },
    properties: {
      name: n.name,
      street: a.road,
      housenumber: a.house_number,
      city: a.city ?? a.town ?? a.village ?? a.hamlet ?? a.suburb,
      postcode: a.postcode,
      country: a.country,
      state: a.state,
    },
  };
}

async function searchPhoton(q: string, signal: AbortSignal): Promise<PhotonFeature[]> {
  const r = await fetch(`${PHOTON}/?q=${encodeURIComponent(q)}&bbox=${SI_BBOX}&limit=6`, { signal });
  if (!r.ok) throw new Error(`Photon HTTP ${r.status}`);
  const data: { features: PhotonFeature[] } = await r.json();
  return data.features || [];
}

async function searchNominatim(q: string, signal: AbortSignal): Promise<PhotonFeature[]> {
  const url = `${NOMINATIM}?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=6&viewbox=${SI_VIEWBOX}&bounded=1&countrycodes=si`;
  const r = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`Nominatim HTTP ${r.status}`);
  const data: NominatimResult[] = await r.json();
  return (data || []).map(nominatimToFeature);
}

type Props = {
  onPick: (lng: number, lat: number) => void;
};

const AddressSearch = forwardRef<AddressSearchHandle, Props>(function AddressSearch({ onPick }, ref) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PhotonFeature[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    clear: () => {
      setQ("");
      setResults([]);
      setOpen(false);
      setErr(null);
      abortRef.current?.abort();
    },
  }));

  // Debounced search: Photon first, Nominatim as fallback if Photon fails.
  useEffect(() => {
    if (q.trim().length < MIN_QUERY) {
      setResults([]);
      setErr(null);
      return;
    }
    const handle = setTimeout(() => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);
      (async () => {
        try {
          // Photon doesn't support "sl" — accepts en/de/fr/it/ja. Use default (no lang).
          const features = await searchPhoton(q, ac.signal);
          setResults(features);
          setErr(null);
        } catch (e: unknown) {
          if ((e as { name?: string })?.name === "AbortError") return;
          try {
            const features = await searchNominatim(q, ac.signal);
            setResults(features);
            setErr(null);
          } catch (e2: unknown) {
            if ((e2 as { name?: string })?.name === "AbortError") return;
            setResults([]);
            setErr("Iskanje naslova ni na voljo");
          }
        } finally {
          if (!ac.signal.aborted) setLoading(false);
        }
      })();
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
});

export default AddressSearch;

function labelFor(f: PhotonFeature): string {
  const p = f.properties;
  const street = [p.street, p.housenumber].filter(Boolean).join(" ");
  const city = [p.postcode, p.city].filter(Boolean).join(" ");
  return [p.name, street, city].filter(Boolean).join(", ");
}
