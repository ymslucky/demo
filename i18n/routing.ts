import { defineRouting } from "next-intl/routing";

/**
 * Locale routing configuration.
 *
 * `localePrefix: "as-needed"` keeps the default locale (Chinese) at the root —
 * existing URLs like `/about` keep working unchanged, while English lives under
 * `/en/...`. Adding a new locale is a matter of appending it here, creating
 * `messages/<locale>.json`, and re-running the build.
 */
export const routing = defineRouting({
  locales: ["zh", "en"],
  defaultLocale: "zh",
  localePrefix: "as-needed",
});

export type Locale = (typeof routing.locales)[number];
