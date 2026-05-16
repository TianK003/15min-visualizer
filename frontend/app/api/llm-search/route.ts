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

  // Provisional response until Photon + RPC steps land in the next tasks.
  return NextResponse.json({
    kind: "search",
    reply_text_sl: spec.reply_text_sl,
    filter_summary: `Iskane kategorije: ${spec.required_category_indices.length} · Območje: ${spec.target_town ?? "Slovenija"}`,
    reasoning: spec.reasoning,
    results: [],   // ← filled in Task 10
    _debug_spec: spec,
  });
}
