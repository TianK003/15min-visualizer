// E2E smoke test: backend wiring (Supabase REST + RPC, Valhalla, /api/llm, Swagger).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const URL = process.env.URL || "http://localhost:3000";
// Prešernov trg in Ljubljana — known to have score 8 in our dataset.
const HASH = "#lng=14.5061&lat=46.0512&z=14&h3=8a1e1216b367fff";

async function shot(page, name) {
  try {
    await page.screenshot({ path: `scripts/output/${name}.png`, timeout: 5000 });
  } catch {}
}

async function main() {
  mkdirSync("scripts/output", { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  let page = await ctx.newPage();

  const errors = [];
  const requests = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
  });
  page.on("requestfinished", (r) => {
    const u = r.url();
    if (u.includes("127.0.0.1:54321") || u.includes("/api/") || u.includes("/sb/")) {
      r.response().then((resp) => requests.push({ url: u, status: resp?.status() ?? 0, method: r.method() })).catch(() => {});
    }
  });

  console.log(`→ ${URL}/`);
  await page.goto(`${URL}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0, { timeout: 60_000 });
  await page.waitForTimeout(2500);
  await shot(page, "01-country");
  console.log("✓ map renders");

  // Global mode toggle: present in 15-min view, hidden in population, restored after switching back.
  const globalToggleVisible = await page.locator(".mode-toggle-global").isVisible();
  if (!globalToggleVisible) throw new Error("Global .mode-toggle-global not visible by default");
  await page.locator('.view-switch button:has-text("Poseljenost")').click({ force: true });
  await page.waitForTimeout(200);
  const hiddenInPop = await page.locator(".mode-toggle-global").count();
  if (hiddenInPop !== 0) throw new Error("Global mode toggle should not render in population view");
  await page.locator('.view-switch button:has-text("15-min")').click({ force: true });
  await page.waitForTimeout(200);
  const visibleAgain = await page.locator(".mode-toggle-global").isVisible();
  if (!visibleAgain) throw new Error("Global mode toggle should reappear when switching back to 15-min");
  console.log("✓ global mode toggle: visible in 15-min, hidden in Poseljenost, restored on return");

  // Skip the Photon dropdown smoke — flaky network and not required for backend coverage.
  // Address search functionality is exercised via the lat/lng paste route in manual tests.

  // Open a fresh page to deterministically restore from the hash. Same-origin
  // hash-only changes don't re-mount the component.
  await page.close();
  page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
  });
  page.on("requestfinished", (r) => {
    const u = r.url();
    if (u.includes("127.0.0.1:54321") || u.includes("/api/") || u.includes("/sb/")) {
      r.response().then((resp) => requests.push({ url: u, status: resp?.status() ?? 0, method: r.method() })).catch(() => {});
    }
  });
  console.log(`→ ${URL}/${HASH}`);
  await page.goto(`${URL}/${HASH}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0, { timeout: 60_000 });
  // Wait for the score to render. The selector resolves visible but
  // `waitForSelector` is flaky here (probably a multi-canvas raf race) —
  // poll via waitForFunction which doesn't have that issue.
  await page.waitForFunction(
    () => !!document.querySelector(".big-score")?.textContent?.match(/\d/),
    { timeout: 25_000 },
  );
  const scoreText = (await page.locator(".big-score").first().textContent())?.trim();
  console.log(`✓ scorecard score: ${scoreText}`);
  await shot(page, "02-scorecard");

  // Cell open should fire BOTH amenities_for_point RPCs (walk + bike).
  const amenityHits = requests.filter((r) => r.url.includes("rpc/amenities_for_point"));
  if (amenityHits.length < 2) throw new Error(`Expected 2 amenities_for_point POSTs (walk+bike), got ${amenityHits.length}`);
  console.log(`✓ Walk + bike amenity sets fetched: ${amenityHits.length} requests`);

  // Walk/Bike mode toggle.
  await page.locator('.mode-toggle button:has-text("Kolo")').click({ force: true });
  await page.waitForTimeout(200);
  const ariaBike = await page.locator('.mode-toggle button:has-text("Kolo")').getAttribute("aria-pressed");
  if (ariaBike !== "true") throw new Error("bike toggle did not engage");
  console.log("✓ walk/bike toggle");

  // Isochrone — should fire BOTH pedestrian + bicycle in parallel on first show.
  await page.locator(".iso-btn").click({ force: true });
  await page.waitForTimeout(3500);
  await shot(page, "03-isochrone");
  const isoHits = requests.filter((r) => r.url.includes("/api/valhalla/isochrone"));
  if (isoHits.length < 2) throw new Error(`Expected ≥2 isochrone POSTs (walk+bike), got ${isoHits.length}`);
  console.log(`✓ Walk + bike isochrones fetched: ${isoHits.length} requests, status ${isoHits.map((r) => r.status).join(", ")}`);

  // Button label should now say "Skrij dosegljivost".
  const labelShown = (await page.locator(".iso-btn").textContent())?.trim() ?? "";
  if (!labelShown.startsWith("Skrij")) throw new Error(`Expected 'Skrij…' button label, got "${labelShown}"`);
  console.log(`✓ button label switched to: "${labelShown}"`);

  // Mode toggle — should switch polygon WITHOUT new fetch.
  const beforeToggle = requests.filter((r) => r.url.includes("/api/valhalla/isochrone")).length;
  await page.locator('.mode-toggle button:has-text("Hoja")').click({ force: true });
  await page.waitForTimeout(500);
  const afterToggle = requests.filter((r) => r.url.includes("/api/valhalla/isochrone")).length;
  if (afterToggle !== beforeToggle) throw new Error("Mode toggle re-fetched isochrones; should reuse cached pair");
  console.log("✓ mode toggle reuses cached isochrones (no refetch)");

  // Click Skrij — button text returns to "Prikaži…" and no new network calls.
  const beforeHide = requests.length;
  await page.locator(".iso-btn").click({ force: true });
  await page.waitForTimeout(400);
  const labelHidden = (await page.locator(".iso-btn").textContent())?.trim() ?? "";
  if (!labelHidden.startsWith("Prikaži")) throw new Error(`Expected 'Prikaži…' on hide, got "${labelHidden}"`);
  if (requests.length !== beforeHide) throw new Error("Hide click should not trigger any network");
  console.log("✓ Skrij toggles isochrone off without refetch");
  // Click again to show — still no new isochrone fetch (cached).
  await page.locator(".iso-btn").click({ force: true });
  await page.waitForTimeout(400);
  const isoHitsAfter = requests.filter((r) => r.url.includes("/api/valhalla/isochrone")).length;
  if (isoHitsAfter !== isoHits.length) throw new Error("Re-show should reuse cached isochrones");
  console.log("✓ Prikaži re-show reuses cached isochrones");

  // Click the "Trgovina" row → expect one /route POST and a visible path layer.
  await page.locator('.scorecard-row.ok[data-cat="trgovina"]').click({ force: true });
  await page.waitForTimeout(2500);
  await shot(page, "04-route");
  const routeHits = requests.filter((r) => r.url.includes("/api/valhalla/route"));
  if (routeHits.length === 0) throw new Error("No /route request observed after category click");
  console.log(`✓ Route fetched on category click: ${routeHits.length} request(s), status ${routeHits[0].status}`);

  // Provenance.
  await page.locator(".provenance-link").click({ force: true });
  await page.waitForSelector(".provenance", { timeout: 4000 });
  await shot(page, "05-provenance");
  console.log("✓ provenance panel");
  await page.locator(".provenance .scorecard-close").click({ force: true });
  await page.waitForTimeout(200);

  // /api-docs Swagger.
  await page.goto(`${URL}/api-docs`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const sw = await page.locator(".swagger-ui").isVisible().catch(() => false);
  await shot(page, "06-swagger");
  console.log(sw ? "✓ Swagger UI mounted at /api-docs" : "⚠ Swagger UI not visible");

  // /api/llm.
  const r1 = await fetch(`${URL}/api/llm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "narrative", h3: "8a1e1216b367fff", score: 8, walk_min: [5, 10, 15, 5, 10, null, 15, null] }),
  }).then((r) => r.json());
  if (r1.kind !== "narrative" || typeof r1.text_sl !== "string") throw new Error("LLM narrative shape wrong");
  console.log(`✓ /api/llm narrative: "${r1.text_sl.slice(0, 60)}…"`);

  const r2 = await fetch(`${URL}/api/llm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "narrative" }),
  });
  if (r2.status !== 422) throw new Error(`Expected 422, got ${r2.status}`);
  console.log("✓ /api/llm 422 on bad payload");

  // /api/llm kind:"search" — used to 500 with "Failed to parse URL from
  // /sb/rest/v1/rpc/llm_search_cells" because the server was reading the
  // browser-only NEXT_PUBLIC_SUPABASE_URL=/sb proxy path. The fix routes
  // server fetches through absolute SUPABASE_INTERNAL_URL. We don't assert
  // 200 (OpenRouter is external + can flake), only that the *specific*
  // URL-parse regression doesn't reappear.
  const r3 = await fetch(`${URL}/api/llm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "search", query: "Sva mlada družina v Ljubljani", history: [] }),
  });
  const r3text = await r3.text();
  if (r3text.includes("Failed to parse URL") || r3text.includes("/sb/rest/v1/rpc/llm_search_cells")) {
    throw new Error(`/api/llm URL-parse fix regressed: ${r3text.slice(0, 200)}`);
  }
  console.log(`✓ /api/llm search: status ${r3.status}, no URL-parse regression`);

  // Summary of requests.
  console.log("\n=== Unique backend-touching requests ===");
  const seen = new Set();
  requests.forEach((r) => {
    const k = `${r.status} ${r.method} ${r.url.split("?")[0]}`;
    if (!seen.has(k)) {
      seen.add(k);
      console.log(`  [${r.status}] ${r.method} ${r.url.slice(0, 110)}`);
    }
  });

  const hard = errors.filter((e) => e.startsWith("pageerror:"));
  if (hard.length) {
    console.log("\nHard page errors:");
    hard.forEach((e) => console.log("  " + e));
    throw new Error("Hard page errors");
  }
  await browser.close();
  console.log("\n✓ all smoke tests passed");
}

main().catch((e) => {
  console.error("\n✗", e.message);
  process.exit(1);
});
