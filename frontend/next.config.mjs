/** @type {import('next').NextConfig} */
const SUPABASE_INTERNAL = process.env.SUPABASE_INTERNAL_URL ?? "http://127.0.0.1:54321";

const nextConfig = {
  reactStrictMode: true,
  // Don't bundle @opentelemetry/api — it's a transitive dep of the Vercel
  // AI SDK (instrumentation hooks). Next 14 dev mode keeps trying to emit
  // a vendor-chunk for it and then fails to find it after edits, breaking
  // unrelated API routes like /api/valhalla/route with a MODULE_NOT_FOUND.
  // Treating it as an external server package skips webpack bundling
  // entirely for that module.
  experimental: {
    serverComponentsExternalPackages: ["@opentelemetry/api"],
  },
  // Proxy Supabase REST + Storage through the Next dev server.
  // Why: Windows browsers hitting a WSL2 dev server only get localhost
  // forwarding for the Next port (3000). Supabase's 54321 is unreachable
  // from the Windows side. Proxying makes every request same-origin.
  async rewrites() {
    return [
      { source: "/sb/:path*", destination: `${SUPABASE_INTERNAL}/:path*` },
    ];
  },
};

export default nextConfig;
