import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "15min Slovenija",
  description: "15-minutni mestni indeks za vso Slovenijo — pešačite do osnovnih dnevnih opravil v 15 minutah.",
};

// Pre-paint script that picks the theme before React hydrates. Avoids the
// "light-mode flash" on dark-mode users' page loads. Reads localStorage first
// (explicit user choice), then prefers-color-scheme (system default).
const THEME_INIT_SCRIPT = `(() => {
  try {
    const stored = window.localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark') {
      document.documentElement.setAttribute('data-theme', stored);
      return;
    }
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  } catch {
    document.documentElement.setAttribute('data-theme', 'light');
  }
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
