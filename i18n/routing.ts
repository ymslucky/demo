import { defineRouting } from "next-intl/routing";

/**
 * Locale routing configuration.
 *
 * `localePrefix: "as-needed"` serves the default locale (`zh`) without a
 * prefix (`rdom.cn/...`), while non-default locales keep theirs (`/en/...`).
 * Prefixed URLs of the default locale (`/zh/...`) are normalized back to the
 * unprefixed path by `intlMiddleware`, and the bare `/` (or any unprefixed
 * path) is locale-negotiated in `proxy.ts` (NEXT_LOCALE cookie →
 * Accept-Language → `zh`) — `app/route.ts` mirrors that for the EdgeOne
 * static layer.
 */
export const routing = defineRouting({
  locales: ["zh", "en"],
  defaultLocale: "zh",
  localePrefix: "as-needed",
});

export type Locale = (typeof routing.locales)[number];
