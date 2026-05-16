// frontend/components/ResultCard.tsx
//
// Bottom-right collapsed FAB → expands into a floating card on click. Self-
// contained state machine:
//   idle → submitting → results (loaded) → idle (reset)
//   submitting → error → idle (reset)
// Calls /api/llm-search. Emits row events upward for Map.tsx to render pins.

"use client";

import { useEffect, useRef, useState } from "react";
import type { SearchResult, SearchResponse } from "@/lib/llm-search";

type Props = {
  /** Called whenever the result set changes (load, reset, error). Map.tsx
   *  uses this to render/clear the 5 pins. */
  onResultsChange: (results: SearchResult[]) => void;
  /** Called when the user clicks "Pokaži na zemljevidu" on an expanded row. */
  onZoomToResult: (r: SearchResult) => void;
  /** Row → pin cross-link: emits the h3 the user is hovering, null on leave. */
  onRowHover?: (h3: string | null) => void;
  /** Pin → row cross-link: when set, the row with this h3 gets the highlight
   *  class so it visually responds to a map-side hover. */
  highlightH3?: string | null;
};

type View =
  | { kind: "idle" }
  | { kind: "submitting"; query: string }
  | { kind: "results"; query: string; data: SearchResponse }
  | { kind: "error"; query: string; message: string };

export default function ResultCard({ onResultsChange, onZoomToResult, onRowHover, highlightH3 }: Props) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [view, setView] = useState<View>({ kind: "idle" });
  const [expanded, setExpanded] = useState<string | null>(null);  // h3 of expanded row
  const [patience, setPatience] = useState(false);  // 10-second "still working" flag
  const abortRef = useRef<AbortController | null>(null);

  // Trigger patience message 10 s after a submit starts. Cleared on any state
  // transition out of "submitting".
  useEffect(() => {
    if (view.kind !== "submitting") {
      setPatience(false);
      return;
    }
    const id = setTimeout(() => setPatience(true), 10_000);
    return () => clearTimeout(id);
  }, [view.kind]);

  const submit = async () => {
    const q = input.trim();
    if (!q) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setView({ kind: "submitting", query: q });
    setExpanded(null);
    onResultsChange([]);

    try {
      const res = await fetch("/api/llm-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, history: [] }),
        signal: ac.signal,
      });
      const data = (await res.json()) as SearchResponse | { error: string };
      if (!res.ok || !("results" in data)) {
        const msg = "error" in data ? data.error : "Servis trenutno ne odgovarja. Poskusi znova.";
        setView({ kind: "error", query: q, message: msg });
        onResultsChange([]);
        return;
      }
      setView({ kind: "results", query: q, data });
      onResultsChange(data.results);
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      setView({ kind: "error", query: q, message: "Servis trenutno ne odgovarja. Poskusi znova." });
      onResultsChange([]);
    }
  };

  const reset = () => {
    abortRef.current?.abort();
    setInput("");
    setView({ kind: "idle" });
    setExpanded(null);
    onResultsChange([]);
  };

  // Collapsed: small floating button just above the Hoja/Kolo switch.
  if (!open) {
    return (
      <button
        type="button"
        className="ai-card-fab"
        onClick={() => setOpen(true)}
        aria-label="Odpri AI svetovalca"
        title="AI svetovalec"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      </button>
    );
  }

  return (
    <div className="ai-card">
      <div className="ai-card-header">
        <span className="ai-card-title">AI svetovalec</span>
        <button
          className="ai-card-close"
          onClick={() => { reset(); setOpen(false); }}
          aria-label="Zapri"
        >
          ×
        </button>
      </div>

      <form
        className="ai-card-input"
        onSubmit={(e) => { e.preventDefault(); submit(); }}
      >
        <textarea
          placeholder="Opiši kaj iščeš (npr. mlada družina v Mariboru, vrtec in zdravstvo)…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={2}
          disabled={view.kind === "submitting"}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button type="submit" disabled={view.kind === "submitting" || !input.trim()}>
          Pošlji
        </button>
      </form>

      <ResultBody
        view={view}
        patience={patience}
        expanded={expanded}
        setExpanded={setExpanded}
        onZoomToResult={onZoomToResult}
        onRowHover={onRowHover}
        highlightH3={highlightH3}
      />
    </div>
  );
}

function ResultBody({
  view, patience, expanded, setExpanded, onZoomToResult, onRowHover, highlightH3,
}: {
  view: View;
  patience: boolean;
  expanded: string | null;
  setExpanded: (h3: string | null) => void;
  onZoomToResult: (r: SearchResult) => void;
  onRowHover?: (h3: string | null) => void;
  highlightH3?: string | null;
}) {
  if (view.kind === "idle") {
    return <div className="ai-card-empty">Vpiši opis tvoje situacije.</div>;
  }
  if (view.kind === "submitting") {
    return (
      <div className="ai-card-loading">
        <div>Iščem…</div>
        {patience && (
          <div className="ai-card-patience">Še vedno se trudim, hvala za potrpežljivost</div>
        )}
      </div>
    );
  }
  if (view.kind === "error") {
    return <div className="ai-card-error">{view.message}</div>;
  }
  // view.kind === "results"
  const { data } = view;
  if (data.results.length === 0) {
    return <div className="ai-card-empty">Ni primernih območij — poskusi z drugim opisom.</div>;
  }
  return (
    <div className="ai-card-results">
      <div className="ai-card-reply">{data.reply_text_sl}</div>
      <div className="ai-card-summary">{data.filter_summary}</div>
      <ul className="ai-card-list">
        {data.results.map((r, idx) => (
          <ResultRow
            key={r.h3}
            rank={idx + 1}
            r={r}
            expanded={expanded === r.h3}
            highlight={highlightH3 === r.h3}
            onToggle={() => setExpanded(expanded === r.h3 ? null : r.h3)}
            onZoom={() => onZoomToResult(r)}
            onHover={(hover) => onRowHover?.(hover ? r.h3 : null)}
          />
        ))}
      </ul>
    </div>
  );
}

function ResultRow(
  { rank, r, expanded, highlight, onToggle, onZoom, onHover }:
  {
    rank: number;
    r: SearchResult;
    expanded: boolean;
    highlight: boolean;
    onToggle: () => void;
    onZoom: () => void;
    onHover: (hover: boolean) => void;
  }
) {
  return (
    <li
      className={`ai-card-row${expanded ? " expanded" : ""}${highlight ? " highlight" : ""}`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <button className="ai-card-row-head" onClick={onToggle} aria-expanded={expanded}>
        <span className="ai-card-rank">{rank}</span>
        <span className="ai-card-place">{r.obcina_name}</span>
        <span className={`ai-card-score score-${bucket(r.walk_score)}`}>
          {r.walk_score}/8
        </span>
        <span className="ai-card-chevron">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && <ResultRowDetail r={r} onZoom={onZoom} />}
    </li>
  );
}

function ResultRowDetail({ r, onZoom }: { r: SearchResult; onZoom: () => void }) {
  const CATS = ["Trgovina","Izobraževanje","Zdravstvo","Park","Promet","Šport","Storitve","Delo"];
  return (
    <div className="ai-card-row-body">
      <div className="ai-card-meta">
        Občina {r.obcina_name} · {Math.round(r.population).toLocaleString("sl-SI")} prebivalcev
      </div>
      <div className="ai-card-cats">
        {CATS.map((label, i) => {
          const t = r.walk_min[i];
          const ok = t !== null && t !== undefined && t <= 15;
          return (
            <span key={i} className={`ai-card-cat${ok ? " ok" : " miss"}`}>
              {ok ? "✓" : "✗"} {label}
            </span>
          );
        })}
      </div>
      {(r.el65 !== null || r.kids !== null) && (
        <div className="ai-card-demo">
          {r.el65 !== null && <>Delež 65+: {(r.el65 * 100).toFixed(1)}%</>}
          {r.el65 !== null && r.kids !== null && <> · </>}
          {r.kids !== null && <>0–14: {(r.kids * 100).toFixed(1)}%</>}
        </div>
      )}
      <button className="ai-card-zoom" onClick={onZoom}>Pokaži na zemljevidu</button>
    </div>
  );
}

function bucket(s: number): "g" | "y" | "o" | "r" {
  if (s >= 6) return "g";
  if (s >= 4) return "y";
  if (s >= 2) return "o";
  return "r";
}
