// Server-only LLM proxy route (TASKS §G3).
//
// Use cases:
//   A. Natural-language search — convert a free-form SL query into a typed filter spec.
//   B. Cell narrative — generate a 2–3-sentence SL description for a clicked cell.
//
// The route validates the inbound JSON with Zod, never returns raw model output
// to the client without re-shaping it, and gates real network calls behind the
// KIMI_API_KEY env var. When the key is absent (current state), we return a
// well-typed stub so the frontend wiring can be developed end-to-end.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const NarrativeReq = z.object({
  kind: z.literal("narrative"),
  h3: z.string().min(15).max(15),
  score: z.number().int().min(0).max(8),
  walk_min: z.array(z.number().nullable()).length(8),
  obcina: z.string().optional(),
  unbuildable: z.boolean().optional(),
});

const SearchReq = z.object({
  kind: z.literal("search"),
  query: z.string().min(1).max(300),
});

const Body = z.discriminatedUnion("kind", [NarrativeReq, SearchReq]);

const FilterSpec = z.object({
  scope: z.enum(["cell", "obcina", "region"]),
  mean_score: z.string().optional(),    // e.g. ">=4"
  category_underserved: z.string().optional(),
  driver: z.string().optional(),
});

const NarrativeRes = z.object({ kind: z.literal("narrative"), text_sl: z.string() });
const SearchRes = z.object({ kind: z.literal("search"), filter: FilterSpec });

export type LlmResponse = z.infer<typeof NarrativeRes> | z.infer<typeof SearchRes>;

export async function POST(req: NextRequest) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Schema validation failed", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const key = process.env.KIMI_API_KEY;
  if (!key) {
    // Stub response — wired so the frontend can integrate before the API key is set.
    if (parsed.data.kind === "narrative") {
      const score = parsed.data.score;
      const text_sl =
        score >= 6
          ? "Območje ima v 15 minutah hoje dosegljive vse glavne kategorije dnevnih opravil."
          : score >= 4
            ? "Območje ima v 15 minutah hoje dosegljive nekatere dnevne potrebe, druge so dlje."
            : "Območje je v 15 minutah hoje slabše opremljeno; najbližje storitve so v sosednjih naseljih.";
      return NextResponse.json({ kind: "narrative", text_sl, stub: true });
    }
    return NextResponse.json({
      kind: "search",
      filter: { scope: "obcina", mean_score: ">=4" },
      stub: true,
    });
  }

  // Real Kimi call lives here once KIMI_API_KEY is provided.
  // const upstream = await fetch("https://api.moonshot.cn/v1/chat/completions", { ... })
  return NextResponse.json(
    { error: "LLM upstream wiring pending; set KIMI_API_KEY then implement upstream call." },
    { status: 501 },
  );
}
