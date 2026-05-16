// frontend/app/api/llm-search/route.ts
//
// LLM-driven cell search. Replaces v1's /api/llm flow. Single-shot:
//   1. validate input
//   2. generateObject() against MINIMAX via OpenRouter
//   3. resolve target_town (Photon) — added in next task
//   4. call search_cells_v2 RPC — added in next task
//   5. return SearchResponse
//
// AI SDK v6 note: `mode: "json"` was removed; structured-output JSON mode is
// automatic when `schema` is provided (output defaults to 'object'). The
// `messages` parameter is unchanged and still accepted as part of `Prompt`.

import { NextRequest, NextResponse } from "next/server";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateObject } from "ai";
import { z } from "zod";
import { SearchSpec, SYSTEM_PROMPT } from "@/lib/llm-search";

export const runtime = "nodejs";

const ChatMessage = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});
const Body = z.object({
  query: z.string().min(1).max(500),
  history: z.array(ChatMessage).default([]),
});

export async function POST(req: NextRequest) {
  let payload: unknown;
  try { payload = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON" }, { status: 400 }); }

  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Schema validation failed", issues: parsed.error.issues }, { status: 422 });
  }
  const { query, history } = parsed.data;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "LLM not configured" }, { status: 501 });
  }

  const openrouter = createOpenRouter({ apiKey });
  const model = openrouter(process.env.MODEL ?? "minimax/minimax-m2.7");

  let spec: z.infer<typeof SearchSpec>;
  try {
    const result = await generateObject({
      model,
      schema: SearchSpec,
      system: SYSTEM_PROMPT,
      messages: [...history, { role: "user", content: query }],
      maxRetries: 1,
    });
    spec = result.object;
  } catch (err) {
    console.warn("LLM generateObject failed:", err);
    return NextResponse.json({ error: "Nisem te razumel, poskusi malo bolj jasno" }, { status: 502 });
  }

  // (1) If LLM provided target_town, geocode via Photon and build h3 disk.
  let h3_in: string[] | undefined;
  let target_lat: number | null = null;
  let target_lng: number | null = null;
  let geocodedNote = "";

  if (spec.target_town && spec.target_town.trim()) {
    try {
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(spec.target_town)}&bbox=13.3,45.4,16.7,46.9&limit=1`;
      const g = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (g.ok) {
        const data = (await g.json()) as { features?: { geometry: { coordinates: [number, number] } }[] };
        const f = data.features?.[0];
        if (f) {
          [target_lng, target_lat] = f.geometry.coordinates;
          // h3.gridDisk needs the cell, not the coord. Load lazily — keeps
          // the Node import out of the cold path for queries without a target.
          const h3 = await import("h3-js");
          const center = h3.latLngToCell(target_lat, target_lng, 10);
          h3_in = h3.gridDisk(center, 40);   // ~5-7 km radius
        }
      }
    } catch (err) {
      console.warn("Photon failed, searching nationally:", err);
      geocodedNote = " (iskal sem po vsej Sloveniji)";
    }
  }
  if (spec.target_town && !h3_in) {
    geocodedNote = " (iskal sem po vsej Sloveniji)";
  }

  // (2) Call the RPC.
  const supabaseUrl = process.env.SUPABASE_INTERNAL_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || supabaseUrl.startsWith("/")) {
    return NextResponse.json({ error: "SUPABASE_INTERNAL_URL is unset or non-absolute" }, { status: 500 });
  }

  const rpcBody = {
    filter_spec: {
      required_category_indices: spec.required_category_indices,
      ...(h3_in ? { h3_in } : {}),
    },
    ranking_weights: spec.ranking_weights,
    target_lat,
    target_lng,
    p_limit: 5,
  };

  const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/search_cells_v2`, {
    method: "POST",
    headers: {
      apikey: supabaseAnon!,
      Authorization: `Bearer ${supabaseAnon}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(rpcBody),
  });
  if (!rpcRes.ok) {
    console.warn("RPC failed:", await rpcRes.text());
    return NextResponse.json({ error: "Search backend failed" }, { status: 500 });
  }
  const results = await rpcRes.json();

  // (3) Build a Slovenian filter summary for the UI.
  const catLabels = ["Trgovina","Izobraževanje","Zdravstvo","Park","Promet","Šport","Storitve","Delo"];
  const searchedCats = spec.required_category_indices.map((i) => catLabels[i]).join(", ") || "vse";
  const areaStr = spec.target_town ? `${spec.target_town}${geocodedNote || " (~5 km)"}` : "vsa Slovenija";
  const filter_summary = `Iskane kategorije: ${searchedCats} · Območje: ${areaStr} · Najdenih: ${results.length}`;

  return NextResponse.json({
    kind: "search",
    reply_text_sl: spec.reply_text_sl,
    filter_summary,
    reasoning: spec.reasoning,
    results,
  });
}
