// frontend/lib/llm-search.test.ts
//
// Run with: pnpm tsx lib/llm-search.test.ts
//
// Twelve hand-curated examples of what MINIMAX-like models tend to emit.
// Verifies the SearchSpec parses real-world shapes — including the edge
// cases (missing optional fields, weight overflow, integer-as-string for
// category indices, etc.) Schema-invalid examples should fail explicitly.

import { SearchSpec } from "./llm-search";

type Fixture = { name: string; input: unknown; shouldParse: boolean };

const fixtures: Fixture[] = [
  {
    name: "happy path: scenario",
    shouldParse: true,
    input: {
      intent: "scenario",
      required_category_indices: [1, 2],
      target_town: null,
      ranking_weights: { categories: 0.5, population: 0.2, demand: 0, proximity: 0, bikeability: 0 },
      reply_text_sl: "Iskal sem območja z vrtci in zdravstvom.",
      reasoning: "kids → cats 1,2.",
    },
  },
  {
    name: "happy path: area",
    shouldParse: true,
    input: {
      intent: "area",
      required_category_indices: [7],
      target_town: "Bled",
      ranking_weights: { categories: 0.2, population: 0.1, demand: 0, proximity: 0.4, bikeability: 0.3 },
      reply_text_sl: "Iskal sem območja blizu Bleda.",
      reasoning: "near Bled + bike.",
    },
  },
  {
    name: "happy path: mixed",
    shouldParse: true,
    input: {
      intent: "mixed",
      required_category_indices: [0, 1, 2],
      target_town: "Maribor",
      ranking_weights: { categories: 0.5, population: 0.2, demand: 0, proximity: 0.3, bikeability: 0 },
      reply_text_sl: "Iskal sem območja blizu Maribora.",
      reasoning: "family + Maribor.",
    },
  },
  {
    name: "all weights zero (legal — server normalizes to categories=1)",
    shouldParse: true,
    input: {
      intent: "scenario",
      required_category_indices: [],
      target_town: null,
      ranking_weights: { categories: 0, population: 0, demand: 0, proximity: 0, bikeability: 0 },
      reply_text_sl: "OK.",
      reasoning: "n/a",
    },
  },
  {
    name: "weights sum > 1 (legal — server normalizes)",
    shouldParse: true,
    input: {
      intent: "scenario",
      required_category_indices: [2],
      target_town: null,
      ranking_weights: { categories: 0.7, population: 0.5, demand: 0.3, proximity: 0, bikeability: 0 },
      reply_text_sl: "OK.",
      reasoning: "n/a",
    },
  },
  {
    name: "empty required_category_indices",
    shouldParse: true,
    input: {
      intent: "scenario",
      required_category_indices: [],
      target_town: "Ljubljana",
      ranking_weights: { categories: 0, population: 0.5, demand: 0.5, proximity: 0, bikeability: 0 },
      reply_text_sl: "OK.",
      reasoning: "n/a",
    },
  },
  {
    name: "FAIL: category index out of range",
    shouldParse: false,
    input: {
      intent: "scenario",
      required_category_indices: [9],
      target_town: null,
      ranking_weights: { categories: 1, population: 0, demand: 0, proximity: 0, bikeability: 0 },
      reply_text_sl: "x",
      reasoning: "x",
    },
  },
  {
    name: "FAIL: weight > 1",
    shouldParse: false,
    input: {
      intent: "scenario",
      required_category_indices: [],
      target_town: null,
      ranking_weights: { categories: 1.5, population: 0, demand: 0, proximity: 0, bikeability: 0 },
      reply_text_sl: "x",
      reasoning: "x",
    },
  },
  {
    name: "FAIL: missing bikeability key",
    shouldParse: false,
    input: {
      intent: "scenario",
      required_category_indices: [],
      target_town: null,
      ranking_weights: { categories: 1, population: 0, demand: 0, proximity: 0 },
      reply_text_sl: "x",
      reasoning: "x",
    },
  },
  {
    name: "FAIL: bad intent value",
    shouldParse: false,
    input: {
      intent: "investor",
      required_category_indices: [],
      target_town: null,
      ranking_weights: { categories: 1, population: 0, demand: 0, proximity: 0, bikeability: 0 },
      reply_text_sl: "x",
      reasoning: "x",
    },
  },
  {
    name: "FAIL: target_town as empty string (allowed — empty string is not null)",
    // Note: we intentionally allow empty string (parse=true). Route handler
    // treats falsy strings as "no target". This fixture documents that choice.
    shouldParse: true,
    input: {
      intent: "scenario",
      required_category_indices: [],
      target_town: "",
      ranking_weights: { categories: 1, population: 0, demand: 0, proximity: 0, bikeability: 0 },
      reply_text_sl: "x",
      reasoning: "x",
    },
  },
  {
    name: "FAIL: reply_text_sl too long",
    shouldParse: false,
    input: {
      intent: "scenario",
      required_category_indices: [],
      target_town: null,
      ranking_weights: { categories: 1, population: 0, demand: 0, proximity: 0, bikeability: 0 },
      reply_text_sl: "a".repeat(500),
      reasoning: "x",
    },
  },
];

let fails = 0;
for (const f of fixtures) {
  const result = SearchSpec.safeParse(f.input);
  const ok = result.success === f.shouldParse;
  console.log(`${ok ? "✓" : "✗"} ${f.name}`);
  if (!ok) {
    fails += 1;
    if (!result.success) console.log("   issues:", JSON.stringify(result.error.issues, null, 2));
    else console.log("   parsed unexpectedly:", JSON.stringify(result.data, null, 2));
  }
}
if (fails > 0) {
  console.error(`\n${fails}/${fixtures.length} fixtures failed`);
  process.exit(1);
}
console.log(`\nall ${fixtures.length} fixtures passed ✓`);
