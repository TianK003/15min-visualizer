"use client";

import { useEffect, useState } from "react";

export type Theme = "light" | "dark";
const STORAGE_KEY = "theme";

function getInitialTheme(): Theme {
  if (typeof document !== "undefined") {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "dark" || attr === "light") return attr;
  }
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
}

/**
 * Single source of truth for the active theme. The pre-paint <script> in
 * RootLayout writes data-theme on <html> before React hydrates so there is no
 * light-flash on first paint; this hook then mirrors that value into React
 * state and keeps localStorage + DOM in sync on subsequent flips.
 */
export function useTheme(): [Theme, (next: Theme) => void, () => void] {
  const [theme, setThemeState] = useState<Theme>(() => getInitialTheme());

  useEffect(() => {
    applyTheme(theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // localStorage can throw under private-browsing quotas. Fine to ignore —
      // the DOM attribute still drives styling for the current session.
    }
  }, [theme]);

  const setTheme = (next: Theme) => setThemeState(next);
  const toggle = () => setThemeState((t) => (t === "dark" ? "light" : "dark"));
  return [theme, setTheme, toggle];
}

export const THEME_STORAGE_KEY = STORAGE_KEY;
