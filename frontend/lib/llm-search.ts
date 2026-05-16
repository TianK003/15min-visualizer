// frontend/lib/llm-search.ts
//
// Shared contract for the LLM-driven search. The Zod schema is the single
// source of truth for what the LLM must emit and what the route handler can
// rely on. The system prompt below references the same category indices and
// weight keys, so changes here cascade automatically.

import { z } from "zod";

export const SearchSpec = z.object({
  intent: z.enum(["scenario", "area", "mixed"])
    .describe("scenario=life-stage query; area=place-anchored; mixed=both"),

  required_category_indices: z.array(z.number().int().min(0).max(7))
    .max(8)
    .describe("0=Trgovina 1=Izobraževanje 2=Zdravstvo 3=Park 4=Promet 5=Šport 6=Storitve 7=Delo. Empty array if no hard requirement."),

  target_town: z.string().nullable()
    .describe("Slovenian place name to anchor the search around. null if user gave no location."),

  ranking_weights: z.object({
    categories:  z.number().min(0).max(1),
    population:  z.number().min(0).max(1),
    demand:      z.number().min(0).max(1),
    proximity:   z.number().min(0).max(1),
    bikeability: z.number().min(0).max(1),
  }).describe("0..1 each, roughly summing to 1 (server normalizes). bikeability MUST be 0 unless the user explicitly mentions cycling/biking/'no car'."),

  reply_text_sl: z.string().max(400)
    .describe("Friendly Slovenian summary, 2-3 sentences, addressed to the user."),

  reasoning: z.string().max(600)
    .describe("Short English explanation of how the user's words mapped to categories and weights. Used for debug, not shown by default."),
});
export type SearchSpec = z.infer<typeof SearchSpec>;

/** One row of the search result, returned by the RPC + included in the API response. */
export type SearchResult = {
  h3: string;
  sifra: number;
  obcina_name: string;
  walk_score: number;
  bike_score: number;
  walk_min: (number | null)[];
  population: number;
  el65: number | null;
  kids: number | null;
  cats_hit: number;
  cats_required: number;
  composite: number;
};

/** Shape returned by /api/llm-search to the browser. */
export type SearchResponse = {
  kind: "search";
  reply_text_sl: string;
  filter_summary: string;
  reasoning: string;
  results: SearchResult[];
};

export const CATEGORY_LABELS_SL = [
  "Trgovina",
  "Izobraževanje",
  "Zdravstvo",
  "Park",
  "Javni promet",
  "Šport",
  "Storitve",
  "Delo",
] as const;

export const SYSTEM_PROMPT = `You are a geographic search assistant for the "15min Slovenija" map.
You translate a user's free-text Slovenian message into a structured search over H3 cells across Slovenia.

# Categories (0-indexed)
0 = Trgovina (shops, supermarkets, lekarna)
1 = Izobraževanje (vrtec, schools)
2 = Zdravstvo (clinics, doctors, pharmacy)
3 = Park (parks, green space)
4 = Javni promet (bus, train stops)
5 = Šport (gyms, sport facilities)
6 = Storitve (post, bank, services)
7 = Delo (offices, jobs)

# Ranking weights (each 0..1, sum is normalized server-side)
- categories: emphasize cells that hit ALL the required categories within 15 min walk. Use 0.4–0.6 as the typical baseline.
- population: prefer denser, more urban areas. Up when user wants amenities/community.
- demand: prefer areas where many people live but walkability is low. Up for investor queries.
- proximity: prefer cells near target_town. Up when the user names a place.
- bikeability: ONLY > 0 if the user explicitly mentions cycling, biking, e-bike, or "no car / no driving". Default 0. Do NOT infer it from a generic "active lifestyle" phrase.

# How to read wants and dislikes
| User signal (sl / en) | Effect |
|---|---|
| "blizu X" / "near X" / "v okolici X" | target_town = X, proximity ↑ (~0.3) |
| "družina z otroci" / "small kids" | required: 1, 2, 3 ; categories ↑ |
| "rad kolesarim" / "we bike" / "no car" | bikeability ↑ (0.3–0.5) |
| "mirno" / "ne želim hrupa" / "no city" | population ↓ (~0.1) |
| "investicija" / "underserved" / "neopremljeno" | demand ↑ (0.5–0.7), categories ↓ |
| "živahno" / "veliko se dogaja" | population ↑ (0.3–0.5) |
| "zeleno" / "narava" | required: 3 (park) |
| "služba v X" / "I commute to X" | target_town = X, required: 7 + 4 |

# Output language
- reasoning: English. Brief. List the keywords → category/weight mappings.
- reply_text_sl: Slovenian. Friendly. 2-3 sentences. Address the user directly.

# Examples

EXAMPLE 1
User: "Sva mlada družina, delava v Mariboru, otrok bo šel v vrtec naslednje leto."
{
  "intent": "mixed",
  "required_category_indices": [1, 2, 0],
  "target_town": "Maribor",
  "ranking_weights": { "categories": 0.5, "population": 0.2, "demand": 0, "proximity": 0.3, "bikeability": 0 },
  "reply_text_sl": "Iskal sem območja blizu Maribora z bližnjim vrtcem, zdravnikom in trgovinami.",
  "reasoning": "'mlada družina'+'vrtec' → cats 1,2. 'trgovine' implied → cat 0. 'Maribor' → target_town, proximity 0.3. No cycling cue → bike 0."
}

EXAMPLE 2
User: "Investitor sem, iščem območje z neopremljenim zdravstvom."
{
  "intent": "scenario",
  "required_category_indices": [],
  "target_town": null,
  "ranking_weights": { "categories": 0.1, "population": 0.3, "demand": 0.6, "proximity": 0, "bikeability": 0 },
  "reply_text_sl": "Iskal sem območja, kjer veliko ljudi živi a zdravstvenih objektov ni v 15 min hoje.",
  "reasoning": "'investitor'+'neopremljeno' → demand-heavy ranking. No location → target_town null."
}

EXAMPLE 3
User: "Najdi 5 lokacij blizu Bleda kjer lahko v službo s kolesom."
{
  "intent": "area",
  "required_category_indices": [7],
  "target_town": "Bled",
  "ranking_weights": { "categories": 0.2, "population": 0.1, "demand": 0, "proximity": 0.4, "bikeability": 0.3 },
  "reply_text_sl": "Iskal sem območja blizu Bleda z dobrim kolesarskim dostopom do služb.",
  "reasoning": "'kolo'+'služba' → bike weight nonzero, required cat 7. 'blizu Bleda' → target_town + proximity."
}

Output a single JSON object matching the schema exactly. No markdown wrapper, no extra prose.`;
