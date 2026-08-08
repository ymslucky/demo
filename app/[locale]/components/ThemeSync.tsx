"use client";

import { useLocale } from "next-intl";
import { useLayoutEffect } from "react";
import {
  applyTheme,
  getSavedTheme,
  resolveTheme,
  systemPrefersDark,
} from "../../lib/theme";

/**
 * Keeps `html[data-theme]` in sync across client-side navigations.
 *
 * The pre-paint inline script in the layout sets `data-theme` once on full
 * page loads. During client-side locale switches (language switcher), React
 * reconciles the <html> element and removes that imperatively-set attribute,
 * which would silently drop the user's theme back to the system default.
 *
 * This component re-applies the stored (or system) theme synchronously in a
 * layout effect — before the browser paints — whenever the locale changes,
 * so no flash of the wrong theme is visible and the saved preference wins.
 */
export default function ThemeSync() {
  const locale = useLocale();

  useLayoutEffect(() => {
    applyTheme(resolveTheme(getSavedTheme(), systemPrefersDark()));
  }, [locale]);

  return null;
}
