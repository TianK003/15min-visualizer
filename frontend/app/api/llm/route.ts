import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import * as h3 from "h3-js";
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

const ChatMessage = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const SearchReq = z.object({
  kind: z.literal("search"),
  query: z.string().min(1).max(500),
  history: z.array(ChatMessage).optional(),
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
      { error: "Missing OPENROUTER_API_KEY. Please set it in .env" },
      { status: 501 }
    );
  }

  const model = process.env.MODEL || "minimax/minimax-01";

  if (parsed.data.kind === "search") {
    // 1. Call OpenRouter to parse constraints
    const CATEGORY_NAMES = [
      "Trgovina", "Izobraževanje", "Zdravstvo", "Park",
      "Javni promet", "Šport", "Storitve", "Delo",
    ];

    const systemPrompt = `You are a helpful geographic assistant for 15min Slovenija.
Your job is to read the user's life scenario and map their needs to our 8 amenity categories and geographic constraints.
Categories (0-indexed):
0 = Trgovina (shops/supermarkets)
1 = Izobraževanje (schools/kindergartens/vrtec)
2 = Zdravstvo (clinics/doctors/lekarna)
3 = Park (parks)
4 = Javni promet (transit/bus/train)
5 = Šport (sports)
6 = Storitve (services/post/bank)
7 = Delo (work/offices)

Rules:
1. Map keywords to categories. Example: "baby" -> 1 (kindergarten) and 2 (pediatrician). "commute" -> 4 (transit). "elderly" -> 2 (health) and 6 (services).
2. For geographic constraints, if they ask to be between two cities (e.g., Ljubljana and Maribor), pick a major town between them (e.g., "Celje" or "Slovenska Bistrica"). If they say "close to Ljubljana", output "Ljubljana" or "Domžale".
3. Return exactly 1 town in "target_town" if a location is implied, otherwise null.
4. In "reasoning", explain step-by-step which keywords from the user's message led you to pick each category and the target town. Be specific (e.g., "'pričakujeva otroka' -> vrtec/šola -> category 1").
5. In "reply_text_sl", write a warm, friendly 2-4 sentence reply IN SLOVENIAN that:
   - Summarizes what you understood from their situation
   - Lists which amenities you searched for and why
   - Mentions the geographic area you focused on and why

You MUST output a valid JSON object matching this schema:
{
  "required_category_indices": [integer],
  "target_town": string | null,
  "reasoning": "Step-by-step English explanation of your mapping logic",
  "reply_text_sl": "Friendly Slovenian reply explaining the search"
}
Do NOT wrap the JSON in markdown blocks. Output raw JSON only.`;

    // Build conversation messages: system + history + current user message
    const chatMessages: Array<{role: string; content: string}> = [
      { role: "system", content: systemPrompt },
    ];

    // Include conversation history (only user/assistant messages, skip filter summaries)
    if (parsed.data.history && parsed.data.history.length > 0) {
      for (const msg of parsed.data.history) {
        chatMessages.push({ role: msg.role, content: msg.content });
      }
    }

    // Add the current user message
    chatMessages.push({ role: "user", content: parsed.data.query });

    const openRouterRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: chatMessages,
        response_format: { type: "json_object" }
      })
    });

    if (!openRouterRes.ok) {
      return NextResponse.json({ error: "LLM API failed", details: await openRouterRes.text() }, { status: 500 });
    }

    const llmData = await openRouterRes.json();
    let resultSpec;
    try {
      const content = llmData.choices[0].message.content;
      // Strip markdown code blocks if any
      const cleaned = content.replace(/^```json\s*/, '').replace(/```\s*$/, '').trim();
      resultSpec = JSON.parse(cleaned);
    } catch (e) {
      return NextResponse.json({ error: "Failed to parse LLM response", raw: llmData.choices[0].message.content }, { status: 500 });
    }

    // 2. Resolve target town to H3 cells
    let h3In: string[] | undefined = undefined;
    if (resultSpec.target_town) {
      // Use Photon Geocoder to find the town coordinates
      const geocodeRes = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(resultSpec.target_town)}&limit=1`);
      if (geocodeRes.ok) {
        const geocodeData = await geocodeRes.json();
        if (geocodeData.features && geocodeData.features.length > 0) {
          const [lng, lat] = geocodeData.features[0].geometry.coordinates;
          const centerH3 = h3.latLngToCell(lat, lng, 10);
          // Radius of 40 hexes is roughly ~5-7km, a good size for a municipality search area
          h3In = h3.gridDisk(centerH3, 40);
        }
      }
    }

    // 3. Query Supabase via our new modular RPC
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    
    const filterPayload = {
      required_category_indices: resultSpec.required_category_indices,
      h3_in: h3In
    };

    const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/llm_search_cells`, {
      method: "POST",
      headers: {
        "apikey": supabaseAnon!,
        "Authorization": `Bearer ${supabaseAnon}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ filter_spec: filterPayload, p_limit: 10 }),
    });

    if (!rpcRes.ok) {
      return NextResponse.json({ error: "Supabase RPC failed", details: await rpcRes.text() }, { status: 500 });
    }

    const topCells = await rpcRes.json();

    // Build a human-readable summary of what was searched
    const searchedCategories = (resultSpec.required_category_indices || []).map(
      (i: number) => CATEGORY_NAMES[i] || `?${i}`
    );
    const filterSummary = [
      `Iskane kategorije: ${searchedCategories.join(", ") || "vse"}`,
      resultSpec.target_town ? `Območje: ${resultSpec.target_town} (~5 km radius)` : "Območje: vsa Slovenija",
      `Najdenih lokacij: ${topCells.length}`,
    ].join(" · ");

    return NextResponse.json({
      kind: "search",
      reply_text_sl: resultSpec.reply_text_sl,
      filter_summary: filterSummary,
      reasoning: resultSpec.reasoning,
      top_cells: topCells,
    });
  }

  // Use Case B: Narrative stub (we can also wire this to OpenRouter later)
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

  return NextResponse.json({ error: "Invalid request kind" }, { status: 400 });
}
