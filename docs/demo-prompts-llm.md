# Pre-demo prompts (LLM search v2)

Type each of the five prompts below into the AI svetovalec card and verify the
result vibe matches the "Expect" column. Manual sign-off; no automated assertion.
Run this checklist before any judge-facing demo.

| # | Prompt (Slovenian) | Expect |
|---|---|---|
| 1 | Sva mlada družina, delava v Mariboru, otrok bo šel v vrtec naslednje leto. | 5 občine clustered in or near Maribor; row 1 walks ≥ 5; vrtec/zdravstvo reachable on most rows. |
| 2 | Investitor sem, iščem območje z neopremljenim zdravstvom. | Larger urban občine (Ljubljana, Maribor, Kranj, Celje); top rows have lower walk_score for cat 2 = high demand. |
| 3 | Najdi 5 lokacij blizu Bleda kjer lahko v službo s kolesom. | Občine within ~15 km of Bled (Radovljica, Bled itself); the LLM should put bikeability > 0 in the spec; rows have high bike_score. |
| 4 | Sem upokojenec, želim mirno okolje blizu morja z bližnjo lekarno. | Coastal občine (Piran, Izola, Koper); el65 share visible in row demographics. |
| 5 | Nimava avta, iščeva stanovanje v centru z dobro povezavo. | Urban centers, high category coverage (especially promet + storitve); LLM may emit bikeability ~0.2. |

If a prompt produces unexpected results, capture:
- The full LLM SearchSpec (visible via `curl /api/llm-search`)
- The RPC's top-5 obcina list
- A note in this file proposing whether the SYSTEM_PROMPT (lib/llm-search.ts) needs an extra few-shot example.
