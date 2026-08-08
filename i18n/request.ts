import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing } from "./routing";

/**
 * Loads the message catalog for the active locale.
 *
 * The catalogs are co-located in `messages/` — one JSON file per locale, so
 * adding a locale only requires a new file plus a routing entry.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  // Typically corresponds to the `[locale]` segment.
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,

    /**
     * Missing-key policy (acceptance: fail visibly in dev, never crash prod).
     *
     * In development a missing message throws so the problem surfaces
     * immediately; in production it is logged and the rendered fallback (the
     * key path, via `getMessageFallback`) keeps the UI functional.
     */
    onError(error) {
      if (process.env.NODE_ENV === "production") {
        console.error(error);
      } else {
        throw error;
      }
    },

    /**
     * Fallback text rendered when a message is missing. Showing the key path
     * makes missing keys visible in the UI instead of silently blank text.
     */
    getMessageFallback({ namespace, key }) {
      return [namespace, key].filter(Boolean).join(".");
    },
  };
});
