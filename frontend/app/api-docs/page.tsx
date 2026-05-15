"use client";

// Live Swagger UI pointed at the auto-generated Supabase OpenAPI spec.
// PostgREST refreshes the spec on every migration, so this stays in sync
// without any code changes. Visitors can run "Try it out" against the public
// dataset with the anon key.

import dynamic from "next/dynamic";
import "swagger-ui-react/swagger-ui.css";

const SwaggerUI = dynamic(() => import("swagger-ui-react"), { ssr: false });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export default function ApiDocsPage() {
  return (
    <div style={{ padding: "16px 24px", maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ margin: "8px 0 12px" }}>API — REST surface</h1>
      <p style={{ marginBottom: 16, color: "#555", fontSize: 14, lineHeight: 1.5 }}>
        Tabele se izpostavijo prek PostgREST. OpenAPI spec generira Supabase samodejno ob vsaki
        migraciji — kar vidite tukaj, je vedno usklajeno s shemo v repu. Vse poizvedbe so na voljo
        z javnim anon ključem, samo branje.
      </p>
      <SwaggerUI
        url={`${SUPABASE_URL}/rest/v1/`}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        requestInterceptor={((req: any) => {
          req.headers = req.headers || {};
          if (!req.headers["apikey"]) req.headers["apikey"] = ANON;
          if (!req.headers["Authorization"]) req.headers["Authorization"] = `Bearer ${ANON}`;
          return req;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any}
      />
    </div>
  );
}
