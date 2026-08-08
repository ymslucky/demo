"use client";

import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import {
  SYSTEM_DARK_QUERY,
  applyTheme,
  getSavedTheme,
  nextTheme,
  persistTheme,
  readCurrentTheme,
  shouldFollowSystem,
  type Theme,
} from "../../lib/theme";

/**
 * Subscribes to theme changes: re-renders when the `data-theme` attribute is
 * modified (toggle click) or when the system preference changes (only while
 * the user has not manually overridden the theme).
 */
function subscribeTheme(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  const mq = window.matchMedia(SYSTEM_DARK_QUERY);
  const onSystemChange = (e: MediaQueryListEvent) => {
    // Ignore system changes once the user has picked a theme manually.
    if (!shouldFollowSystem(getSavedTheme())) return;
    applyTheme(e.matches ? "dark" : "light");
    onChange();
  };
  mq.addEventListener("change", onSystemChange);

  return () => {
    observer.disconnect();
    mq.removeEventListener("change", onSystemChange);
  };
}

function getThemeSnapshot(): Theme {
  return readCurrentTheme();
}

/** SSR phase: render as light when no attribute exists yet to avoid hydration mismatch. */
function getThemeServerSnapshot(): Theme {
  return "light";
}

export default function ThemeToggle() {
  const t = useTranslations("theme");
  // The theme comes from the real DOM state (set by the pre-paint inline
  // script); after a click, MutationObserver drives re-renders — no local copy.
  const theme = useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getThemeServerSnapshot,
  );
  const label = theme === "dark" ? t("toggleToLight") : t("toggleToDark");

  const toggle = () => {
    const next = nextTheme(readCurrentTheme());
    applyTheme(next);
    persistTheme(next);
  };

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={label}
      title={label}
    >
      {/* Sun icon (visible in light mode) */}
      <svg
        className="theme-toggle__icon theme-toggle__icon--sun"
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
      {/* Moon icon (visible in dark mode) */}
      <svg
        className="theme-toggle__icon theme-toggle__icon--moon"
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    </button>
  );
}
