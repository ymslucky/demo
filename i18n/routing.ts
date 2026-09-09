import { defineRouting } from "next-intl/routing";

/**
 * Locale routing configuration.
 *
 * `localePrefix: "as-needed"` serves the default locale (zh) from bare
 * paths (`/`, `/tools/`, ...) while every other locale keeps its prefix
 * (`/en/...`). Unprefixed requests are answered by rewriting to the
 * default-locale route — locally by `intlMiddleware` in `proxy.ts`, in
 * EdgeOne production by the edge rewrites in `edgeone.json` (the EdgeOne
 * adapter drops Next-layer rewrites; see skills/i18n-locale-routing).
 */
export const routing = defineRouting({
  locales: ["zh", "en"],
  defaultLocale: "zh",
  localePrefix: "as-needed",
});

export type Locale = (typeof routing.locales)[number];
