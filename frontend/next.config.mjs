/** @type {import('next').NextConfig} */
const SUPABASE_INTERNAL = process.env.SUPABASE_INTERNAL_URL ?? "http://127.0.0.1:54321";

const nextConfig = {
  reactStrictMode: true,
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
