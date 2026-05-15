import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "15min Slovenija",
  description: "15-minute city accessibility map of Slovenia",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="sl">
      <body>{children}</body>
    </html>
  );
}
