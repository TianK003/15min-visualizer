"use client";

// Tabbed Swagger UI:
//   • "Združena dokumentacija" — ročno vzdrževani OpenAPI 3.1 spec na
//                                /openapi.json, pokrije Next.js poti in
//                                Supabase tabele + RPC.
//   • "Supabase (živo)"         — samodejno generiran PostgREST spec, neposredno
//                                iz delujočega Supabase. Anonimni ključ vbrizgan.

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import "swagger-ui-react/swagger-ui.css";

const SwaggerUI = dynamic(() => import("swagger-ui-react"), { ssr: false });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

type Tab = "app" | "supabase";

export default function ApiDocsPage() {
  const [tab, setTab] = useState<Tab>("app");

  return (
    <div className="api-docs-wrapper">
      <header className="api-docs-header">
        <h1>REST API — 15min Slovenija</h1>
        <p>
          <b>Združena dokumentacija</b> pokrije celoten spekter: ročno spisane Next.js poti (
          <code>/api/llm</code>, <code>/api/valhalla</code>) in glavne Supabase tabele +
          RPC funkcije, ki jih frontend uporablja. <b>Supabase (živo)</b> kaže neposredno
          PostgREST samo-opis trenutnega Supabase strežnika — uporabno za potrditev shem in
          klice iz Swagger UI-ja v živo. Vse je javno z anonimnim ključem (samo branje).
        </p>
        <div className="api-docs-tabs" role="tablist" aria-label="API surface">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "app"}
            className={tab === "app" ? "active" : ""}
            onClick={() => setTab("app")}
          >
            Združena dokumentacija
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "supabase"}
            className={tab === "supabase" ? "active" : ""}
            onClick={() => setTab("supabase")}
          >
            Supabase (živo)
          </button>
        </div>
        <p style={{ marginTop: 12, fontSize: 12 }}>
          <Link href="/">← Nazaj na zemljevid</Link>
        </p>
      </header>

      <main className="api-docs-body" role="tabpanel">
        {tab === "app" ? (
          <SwaggerUI url="/openapi.json" docExpansion="list" defaultModelsExpandDepth={0} />
        ) : (
          <SwaggerUI
            url={`${SUPABASE_URL}/rest/v1/`}
            docExpansion="none"
            defaultModelsExpandDepth={0}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            requestInterceptor={((req: any) => {
              req.headers = req.headers || {};
              if (!req.headers["apikey"]) req.headers["apikey"] = ANON;
              if (!req.headers["Authorization"]) req.headers["Authorization"] = `Bearer ${ANON}`;
              return req;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            }) as any}
          />
        )}
      </main>
    </div>
  );
}
