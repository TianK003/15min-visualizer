"use client";

// "Od kod podatki?" — D6 provenance panel (P0 per TASKS).
// Plain-Slovenian dataset cards, methodology summary, reproducibility footer,
// privacy badge, links to /api-docs (Swagger UI) and the raw OpenAPI JSON,
// and an inline theme toggle (D8).

import ThemeToggle from "@/components/ThemeToggle";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SHA = process.env.NEXT_PUBLIC_GIT_SHA;

type Card = {
  title: string;
  count: string;
  license: string;
  source: string;
  why: string;
};

const CARDS: Card[] = [
  {
    title: "OSM Slovenija (Geofabrik)",
    count: "37 622 amenities",
    license: "ODbL",
    source: "https://download.geofabrik.de/europe/slovenia.html",
    why: "OpenStreetMap je edina prosta, krajevno popolna baza trgovin, šol, zdravstvenih ustanov in postaj v Sloveniji.",
  },
  {
    title: "GURS občine",
    count: "212 poligonov",
    license: "CC-BY 4.0",
    source: "https://github.com/stefanb/gurs-rpe",
    why: "Uradna meja občin je nujna za agregacijo po lokalnih skupnostih in za primerjavo med občinami.",
  },
  {
    title: "ARSO Zavarovana območja",
    count: "531 poligonov",
    license: "CC-BY 4.0",
    source: "https://gis.arso.gov.si/arcgis/services/zavarovana_obmocja/MapServer/WFSServer",
    why: "Naravoarstveni status pove, kje gradnja ni smiselna — uporablja se v investitorskem pogledu.",
  },
  {
    title: "ARSO Natura 2000",
    count: "355 poligonov",
    license: "CC-BY 4.0",
    source: "https://gis.arso.gov.si/arcgis/services/natura2000/MapServer/WFSServer",
    why: "Evropsko zaščitena območja niso ali ne smejo biti pozidana; pomembna pri oceni potenciala razvoja.",
  },
  {
    title: "Kontur Population SI",
    count: "22 034 res-8 → 1 079 666 res-10 otrok",
    license: "CC-BY 4.0",
    source: "https://data.humdata.org/dataset/kontur-population-slovenia",
    why: "Edina javno dostopna baza prebivalstva v H3 mreži — uskladi se z našo geometrijo brez pretvorb.",
  },
  {
    title: "OpenFreeMap osnovni zemljevid",
    count: "globalne vektorske ploščice",
    license: "BSD-2",
    source: "https://openfreemap.org",
    why: "Brez ključa, brez registracije, polna OSM osnova — primerno za prikaz brez stroškov.",
  },
];

type Props = { onClose: () => void };

export default function IzvorPodatkov({ onClose }: Props) {
  return (
    <aside className="provenance" role="dialog" aria-label="Izvor podatkov">
      <button className="scorecard-close" onClick={onClose} aria-label="Zapri">×</button>
      <header className="provenance-hdr">
        <h2>Izvor podatkov</h2>
        <p className="lead">
          Zemljevid pokriva vso Slovenijo. Vsako celico (~66 m) ocenimo 0–8 — koliko od osmih dnevnih
          kategorij je dosegljivih v 15 minutah hoje. Podatki prihajajo iz javnih, prosto-licenčnih
          virov; vse korake izračuna lahko ponovite sami (povezava do kode v dnu).
        </p>
      </header>

      <section className="provenance-cards">
        {CARDS.map((c) => (
          <article key={c.title} className="provenance-card">
            <h3>{c.title}</h3>
            <div className="meta">
              {c.count} · {c.license}
            </div>
            <p>{c.why}</p>
            <a href={c.source} target="_blank" rel="noopener noreferrer">
              {hostFor(c.source)} ↗
            </a>
          </article>
        ))}
      </section>

      <section className="provenance-method">
        <h3>Metodologija</h3>
        <ul>
          <li><b>H3 res-10</b> (~66 m rob) — celica približne velikosti hišnega bloka.</li>
          <li>
            <b>8 kategorij:</b> trgovina, izobraževanje, zdravstvo, park, javni promet, šport,
            storitve, delo (natančen seznam OSM oznak v repu).
          </li>
          <li>
            <b>Formula:</b> Σ I(kategorija dosegljiva v 15 min hoje) → ocena 0–8.
          </li>
          <li>
            <b>Barve:</b> zelena 6+, rumena 4–5, oranžna 2–3, rdeča 0–1.
          </li>
          <li><b>Kolo:</b> bike_min = walk_min / 2,5 (pavšalni faktor).</li>
        </ul>
      </section>

      <section className="provenance-tech">
        <h3>Tehnične podrobnosti</h3>
        <ul>
          <li>
            <a href="/api-docs"><b>REST API — Swagger UI</b></a> · Next.js poti (
            <code>/api/llm</code>, <code>/api/valhalla</code>) + tabele Supabase
          </li>
          <li>
            <a href="/openapi.json" target="_blank" rel="noopener noreferrer">
              OpenAPI 3.1 spec (JSON) ↗
            </a>{" "}
            · ročno vzdrževana specifikacija za Next.js poti
          </li>
          <li>
            <a href={`${SUPABASE_URL}/rest/v1/`} target="_blank" rel="noopener noreferrer">
              Supabase PostgREST spec ↗
            </a>{" "}
            · samodejno generirano iz shema migracij
          </li>
          <li>
            GitHub commit{" "}
            {SHA ? (
              <a href={`https://github.com/TianK003/15minut/commit/${SHA}`}>
                <code>{SHA.slice(0, 7)}</code>
              </a>
            ) : (
              <code>local-dev</code>
            )}
          </li>
        </ul>
      </section>

      <section className="provenance-appearance">
        <h3>Videz</h3>
        <ThemeToggle variant="inline" />
      </section>

      <footer className="provenance-foot">
        <span className="badge">🔒 Naslov se ne hrani. Obdelava poteka v vašem brskalniku.</span>
        <span className="lic">Projekt: Apache 2.0 · Atribucija: © OpenStreetMap contributors</span>
      </footer>
    </aside>
  );
}

function hostFor(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
