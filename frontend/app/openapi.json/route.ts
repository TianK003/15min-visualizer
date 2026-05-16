// /openapi.json — dual content-type endpoint.
//
//   Browser (Accept: text/html, …)  → Swagger UI HTML viewer
//   Anything else (Accept: application/json, */*, missing) → raw JSON spec
//
// This used to be a static file in /public, which gave API consumers their
// JSON but presented users opening the link from "Od kod podatki" with raw,
// unreadable JSON. The dual-content-type route serves both audiences from
// the same URL without breaking existing references (the /api-docs Swagger
// UI loads /openapi.json with Accept: application/json, so it still works).

import spec from "./spec.json";

export const runtime = "nodejs";

const VIEWER_HTML = `<!DOCTYPE html>
<html lang="sl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>15min Slovenija — OpenAPI specifikacija</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css">
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
    .topbar { background: #1f2937; color: #f9fafb; padding: 12px 24px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    .topbar h1 { margin: 0; font-size: 16px; font-weight: 600; }
    .topbar a { color: #93c5fd; text-decoration: none; font-size: 13px; }
    .topbar a:hover { text-decoration: underline; }
    .swagger-ui .topbar { display: none; }
    #swagger-ui { padding: 0 8px; }
  </style>
</head>
<body>
  <div class="topbar">
    <h1>15min Slovenija — REST API</h1>
    <span>
      <a href="/api-docs">Polno orodje (Swagger UI z zavihki) →</a>
      &nbsp;·&nbsp;
      <a href="/openapi.json" download>Prenesi JSON</a>
      &nbsp;·&nbsp;
      <a href="/">← Zemljevid</a>
    </span>
  </div>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.onload = function () {
      // We fetch the spec ourselves with Accept: application/json so this
      // very route returns JSON, then hand the parsed object to Swagger UI.
      // (If we passed { url: "/openapi.json" }, swagger-ui's own fetch may
      //  omit the Accept header and bounce back to this HTML page → infinite
      //  recursion.)
      fetch("/openapi.json", { headers: { Accept: "application/json" } })
        .then(function (r) { return r.json(); })
        .then(function (spec) {
          SwaggerUIBundle({
            spec: spec,
            dom_id: "#swagger-ui",
            docExpansion: "list",
            defaultModelsExpandDepth: 0,
            tryItOutEnabled: true,
          });
        })
        .catch(function (err) {
          document.getElementById("swagger-ui").innerHTML =
            "<p style='padding:24px;color:#b91c1c'>Napaka pri nalaganju specifikacije: " +
            (err && err.message ? err.message : err) + "</p>";
        });
    };
  </script>
</body>
</html>`;

export async function GET(req: Request): Promise<Response> {
  const accept = req.headers.get("accept") ?? "";
  // Browsers send "text/html,application/xhtml+xml,…" as the leading types.
  // fetch() calls and curl with no Accept header send "*/*" — those want JSON.
  // Explicit Accept: application/json also gets JSON.
  if (accept.includes("text/html")) {
    return new Response(VIEWER_HTML, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  return new Response(JSON.stringify(spec), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
