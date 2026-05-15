import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { polygonToCells } from "h3-js";
import { getSupabase } from "@/lib/supabase";

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
  query: z.string().min(1).max(500),
});

const Body = z.discriminatedUnion("kind", [NarrativeReq, SearchReq]);

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

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing OPENROUTER_API_KEY" },
      { status: 501 }
    );
  }

  const model = process.env.MODEL || "minimax/minimax-01";
  const supabase = getSupabase();

  if (parsed.data.kind === "search") {
    // 1. Call OpenRouter to parse constraints
    const systemPrompt = `You are a helpful assistant for 15min Slovenija.
Your job is to read the user's life scenario (in Slovenian) and map their needs to our 8 amenity categories and geographic constraints.
Categories (0-indexed):
0 = Trgovina (shops)
1 = Izobraževanje (schools/kindergartens)
2 = Zdravstvo (clinics/doctors)
3 = Park
4 = Javni promet (transit)
5 = Šport
6 = Storitve (services)
7 = Delo (work)
You MUST output a valid JSON object matching this schema:
{
  "required_category_indices": [integer],
  "target_obcine": [string] (names of Slovenian municipalities like "Celje", "Ljubljana", "Maribor", empty array if anywhere),
  "reply_text_sl": "A friendly 2-sentence conversational reply explaining what you filtered for and why (in Slovenian)."
}
Do NOT wrap the JSON in markdown blocks. Output raw JSON only.`;

    const openRouterRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: parsed.data.query }
        ],
        response_format: { type: "json_object" }
      })
    });

    if (!openRouterRes.ok) {
      return NextResponse.json({ error: "LLM API failed", details: await openRouterRes.text() }, { status: 500 });
    }

    const llmData = await openRouterRes.json();
    let resultSpec;
    try {
      resultSpec = JSON.parse(llmData.choices[0].message.content);
    } catch (e) {
      return NextResponse.json({ error: "Failed to parse LLM response", raw: llmData.choices[0].message.content }, { status: 500 });
    }

    // 2. Resolve target obcine to H3 cells if provided
    let h3In: string[] | undefined = undefined;
    if (resultSpec.target_obcine && resultSpec.target_obcine.length > 0) {
      const { data: obcineData, error: obcineErr } = await supabase
        .from('obcine')
        .select('geom, naziv')
        .in('naziv', resultSpec.target_obcine);
      
      if (!obcineErr && obcineData && obcineData.length > 0) {
        h3In = [];
        for (const ob of obcineData) {
          // geom is a GeoJSON MultiPolygon or Polygon if we fetch it via PostgREST correctly, 
          // wait, PostgREST returns geometries as GeoJSON by default if we ask?
          // Actually, PostgREST returns EWKB format for geometry by default unless cast to GeoJSON.
          // Let's use ST_AsGeoJSON!
        }
      }
    }
  }
}
