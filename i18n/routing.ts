import { defineRouting } from "next-intl/routing";

/**
 * Locale routing configuration.
 *
 * `localePrefix: "always"` gives every locale an explicit prefix (`/zh/...`,
 * `/en/...`). The default locale therefore lives under `/zh/` too, and the
 * bare `/` (or any unprefixed path) is locale-negotiated by `intlMiddleware`
 * in `proxy.ts` (NEXT_LOCALE cookie → Accept-Language → `zh`).
 */
export const routing = defineRouting({
  locales: ["zh", "en"],
  defaultLocale: "zh",
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];
