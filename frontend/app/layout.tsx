import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "15min Slovenija",
  description: "15-minutni mestni indeks za vso Slovenijo — pešačite do osnovnih dnevnih opravil v 15 minutah.",
};

// Pre-paint script that pins the theme to "light" on every page load. Dark
// mode currently has a basemap-label rendering quirk on Positron tiles, so
// reloading always boots into light. The in-session ThemeToggle still flips
// the attribute; we just don't persist or restore the choice across reloads.
const THEME_INIT_SCRIPT = `(() => {
  try { document.documentElement.setAttribute('data-theme', 'light'); } catch {}
})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: the pre-paint script writes data-theme on
    // <html> before React hydrates, so the server-rendered tree (no
    // data-theme) and client tree (data-theme set) intentionally differ on
    // this single attribute.
    <html lang="sl" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
