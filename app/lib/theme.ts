/**
 * Theme management — pure logic + thin DOM helpers.
 *
 * Extracted so the decision logic (stored preference vs system preference)
 * can be unit-tested in isolation (node env), mirroring the app/tools/utils
 * pattern. All DOM access is defensive (SSR-safe).
 *
 * Theme contract (from the CSS in globals.css):
 * - <html> no data-theme attr            -> follows system prefers-color-scheme
 * - <html data-theme="light">            -> forced light
 * - <html data-theme="dark">             -> forced dark
 *
 * localStorage key "theme" holds the manual override ("light" | "dark").
 * Absence of the key means "follow system".
 */

export const THEME_STORAGE_KEY = "theme";

export const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

export type Theme = "light" | "dark";

export const THEMES: readonly Theme[] = ["light", "dark"];

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

/**
 * Resolve the effective theme from a stored preference (or null when the
 * user never chose manually) and the system preference.
 * A valid manual choice always wins; otherwise follow the system.
 */
export function resolveTheme(stored: string | null, systemPrefersDark: boolean): Theme {
  if (isTheme(stored)) return stored;
  return systemPrefersDark ? "dark" : "light";
}

/** Opposite theme (for the toggle button). */
export function nextTheme(current: Theme): Theme {
  return current === "dark" ? "light" : "dark";
}

/** True when the user has NOT manually overridden (i.e. we should follow the system). */
export function shouldFollowSystem(stored: string | null): boolean {
  return !isTheme(stored);
}

/** Safe localStorage read; returns null when unavailable or not a valid theme. */
export function getSavedTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** Safe localStorage write of the manual override. */
export function persistTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // storage unavailable (private mode, SSR) — theme still applies for this page
  }
}

/** Clear the manual override so the site follows the system again. */
export function clearSavedTheme(): void {
  try {
    localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Current system preference for dark. SSR-safe (returns false). */
export function systemPrefersDark(): boolean {
  try {
    return typeof window !== "undefined" && window.matchMedia(SYSTEM_DARK_QUERY).matches;
  } catch {
    return false;
  }
}

/** Current effective theme, reading the DOM attribute first, then the system. */
export function readCurrentTheme(): Theme {
  try {
    const attr = document.documentElement.getAttribute("data-theme");
    if (isTheme(attr)) return attr;
  } catch {
    // document unavailable (SSR)
  }
  return systemPrefersDark() ? "dark" : "light";
}

/** Apply a theme to the document root. */
export function applyTheme(theme: Theme): void {
  try {
    document.documentElement.setAttribute("data-theme", theme);
  } catch {
    // SSR — nothing to apply
  }
}

/**
 * Inline <head>/early-body script that applies the theme BEFORE first paint,
 * preventing a flash of the wrong theme (FOUC). Self-contained ES5, no imports.
 * Same decision logic as resolveTheme: manual override wins, else system.
 */
export function themeInitScript(): string {
  return [
    "(function () {",
    "  try {",
    "    var stored = null;",
    "    try { stored = localStorage.getItem(\"" + THEME_STORAGE_KEY + "\"); } catch (e) {}",
    "    var dark = false;",
    "    try { dark = window.matchMedia && window.matchMedia(\"(prefers-color-scheme: dark)\").matches; } catch (e) {}",
    "    var theme = (stored === \"light\" || stored === \"dark\") ? stored : (dark ? \"dark\" : \"light\");",
    "    document.documentElement.setAttribute(\"data-theme\", theme);",
    "  } catch (e) {}",
    "})();",
  ].join("\n");
}
