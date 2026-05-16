"use client";

import { useEffect, useState } from "react";

export type Theme = "light" | "dark";
const STORAGE_KEY = "theme";

function getInitialTheme(): Theme {
  if (typeof document !== "undefined") {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "dark" || attr === "light") return attr;
  }
  // Pre-paint script in layout.tsx always sets data-theme="light" on load,
  // so reloads always start light. The toggle still works within a session.
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

  // Each call to useTheme owns its own React state, but the DOM attribute on
  // <html> is the single source of truth. Observe attribute flips so a flip
  // from one consumer (e.g. ThemeToggle) propagates into every other
  // consumer's state (e.g. Map.tsx, which needs to re-fire setStyle).
  useEffect(() => {
    if (typeof document === "undefined") return;
    const obs = new MutationObserver(() => {
      const attr = document.documentElement.getAttribute("data-theme");
      if ((attr === "dark" || attr === "light") && attr !== theme) {
        setThemeState(attr);
      }
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, [theme]);

  const setTheme = (next: Theme) => setThemeState(next);
  const toggle = () => setThemeState((t) => (t === "dark" ? "light" : "dark"));
  return [theme, setTheme, toggle];
}

export const THEME_STORAGE_KEY = STORAGE_KEY;
