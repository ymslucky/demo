import { defineRouting } from "next-intl/routing";

/**
 * Locale routing configuration.
 *
 * `localePrefix: "always"` gives every locale an explicit prefix (`/zh/...`,
 * `/en/...`). Static export cannot serve a locale-negotiated `/` (there is no
 * runtime to rewrite it), so the default locale must live under `/zh/` too.
 * The bare `/` is handled by the `functions/index.js` edge function, which
 * redirects to the preferred locale based on the `NEXT_LOCALE` cookie and the
 * `Accept-Language` header.
 */
export const routing = defineRouting({
  locales: ["zh", "en"],
  defaultLocale: "zh",
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];
