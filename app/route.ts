import { NextResponse, type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";

/**
 * Root fallback route for the bare "/" path.
 *
 * On EdgeOne Pages a request matches the static layer first; the adapter
 * serves "/" from that layer (404 for a missing file) without ever reaching
 * the Next.js server — so the `intlMiddleware` negotiation inside proxy.ts
 * never runs for the bare root in production. This handler reproduces the
 * same negotiation server-side (NEXT_LOCALE cookie -> Accept-Language
 * weights -> default).
 *
 * With `localePrefix: "as-needed"` the default locale (`zh`) is served at
 * the unprefixed path, so a negotiated `zh` is answered with an internal
 * rewrite to the `/zh/` tree — the browser URL stays at "/". Redirecting
 * to `/zh/` instead would loop forever: intlMiddleware normalizes prefixed
 * default-locale URLs back to "/" (308) and this handler would 307 them
 * right back. Non-default locales keep a temporary redirect to their
 * prefixed URL (`/en/`).
 *
 * Where the proxy does run (local dev), "/" is answered by intlMiddleware
 * before routing reaches this handler, so it stays an inert fallback.
 * Reading cookies/headers off the request keeps the handler dynamic — it is
 * never prerendered at build time.
 */

/** Parse an Accept-Language header and return the best matching locale. */
function negotiateLocale(acceptLanguage: string | null) {
  const entries = (acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const qParam = params.find((p) => p.trim().startsWith("q="));
      const q = qParam ? Number.parseFloat(qParam.trim().slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), q: Number.isFinite(q) ? q : 0 };
    })
    .filter((entry) => entry.tag.length > 0 && entry.tag !== "*");

  let best = routing.defaultLocale;
  let bestQ = -1;
  for (const entry of entries) {
    const base = entry.tag.split("-")[0];
    const match =
      routing.locales.find((locale) => locale === entry.tag) ??
      routing.locales.find((locale) => locale === base);
    if (match && entry.q > bestQ) {
      best = match;
      bestQ = entry.q;
    }
  }
  return best;
}

export function GET(request: NextRequest) {
  const cookieLocale = request.cookies.get("NEXT_LOCALE")?.value;
  const locale =
    cookieLocale &&
    routing.locales.includes(cookieLocale as (typeof routing.locales)[number])
      ? cookieLocale
      : negotiateLocale(request.headers.get("accept-language"));

  // Default locale lives at the unprefixed URL: rewrite (not redirect) into
  // the /zh/ tree so the address bar stays at "/" — a redirect would ping-
  // pong with intlMiddleware's /zh/ -> / normalization.
  if (locale === routing.defaultLocale) {
    return NextResponse.rewrite(new URL(`/${routing.defaultLocale}/`, request.url));
  }
  return NextResponse.redirect(new URL(`/${locale}/`, request.url));
}
