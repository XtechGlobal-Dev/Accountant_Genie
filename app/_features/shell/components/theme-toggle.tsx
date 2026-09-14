"use client";

/**
 * Light / Dark / System. The choice lives in localStorage and is applied
 * before first paint by the inline script in the root layout, so there is no
 * flash; this control only changes it afterwards.
 */

import { useEffect, useState } from "react";
import { cx } from "@/ui/styles";

export const THEME_STORAGE_KEY = "ledgerly-theme";

type Theme = "light" | "dark" | "system";

const OPTIONS: ReadonlyArray<readonly [Theme, string]> = [
  ["light", "Light"],
  ["dark", "Dark"],
  ["system", "System"],
];

function apply(theme: Theme) {
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  document.documentElement.dataset.theme = resolved;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === "dark" || saved === "light" || saved === "system") setTheme(saved);
    } catch {
      /* Storage can be unavailable; light is the default. */
    }
  }, []);

  useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => apply("system");
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, [theme]);

  const choose = (next: Theme) => {
    setTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    apply(next);
  };

  return (
    <div className="px-2.5 py-2">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
        Appearance
      </p>
      <div
        role="radiogroup"
        aria-label="Appearance"
        className="grid grid-cols-3 gap-1 rounded-xl bg-sunken p-1"
      >
        {OPTIONS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={theme === value}
            onClick={() => choose(value)}
            className={cx(
              "h-7 rounded-lg text-xs font-medium transition-colors",
              theme === value ? "bg-surface text-ink shadow-xs" : "text-ink-2 hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
