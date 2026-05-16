// Server-side Valhalla proxy.
//
// Direct browser → Valhalla calls fail CORS preflight: Valhalla returns 405
// on OPTIONS even though the actual response has Access-Control-Allow-Origin:*.
// Routing through Next.js avoids the preflight (same-origin) and lets us hide
// the real Valhalla URL in production behind a Vercel-only env var.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// In production this becomes the Railway URL.
const VALHALLA = process.env.VALHALLA_URL ?? "http://127.0.0.1:8002";

const ALLOWED = new Set(["isochrone", "route", "locate", "matrix", "sources_to_targets", "trace_route"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ endpoint: string }> },
) {
  const { endpoint } = await params;
  if (!ALLOWED.has(endpoint)) {
    return NextResponse.json({ error: `Unknown endpoint ${endpoint}` }, { status: 400 });
  }

  const body = await req.text();
  const upstream = await fetch(`${VALHALLA}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const data = await upstream.text();
  return new NextResponse(data, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json" },
  });
}
