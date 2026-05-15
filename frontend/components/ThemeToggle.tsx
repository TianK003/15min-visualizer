"use client";

import { useEffect, useState } from "react";
import { useTheme, type Theme } from "@/lib/theme";

type Props = {
  variant?: "icon" | "inline";
  className?: string;
};

const SunIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
);

const MoonIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const label = (t: Theme) => (t === "dark" ? "Preklopi na svetli način" : "Preklopi na temni način");

export default function ThemeToggle({ variant = "icon", className }: Props) {
  const [theme, , toggle] = useTheme();
  // First client render returns the SSR-equivalent placeholder so the icon
  // doesn't trigger a hydration mismatch. The actual icon swaps in after
  // mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = theme === "dark";
  const icon = !mounted ? <MoonIcon /> : isDark ? <SunIcon /> : <MoonIcon />;
  const labelText = !mounted ? "Preklopi način" : label(theme);
  const inlineText = !mounted ? "Način videza" : isDark ? "Svetli način" : "Temni način";

  if (variant === "inline") {
    return (
      <button
        type="button"
        className={`theme-toggle-inline ${className ?? ""}`}
        onClick={toggle}
        aria-label={labelText}
        title={labelText}
      >
        {icon}
        <span>{inlineText}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`theme-toggle ${className ?? ""}`}
      onClick={toggle}
      aria-label={labelText}
      title={labelText}
    >
      {icon}
    </button>
  );
}
