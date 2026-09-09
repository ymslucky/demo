import { NextResponse, type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";

/**
 * Root fallback route for the bare "/" path.
 *
 * Routing uses `localePrefix: "as-needed"`, so the bare root is the
 * canonical zh URL. On EdgeOne the edge rewrites in `edgeone.json` answer
 * "/" with the prerendered "/zh/" page directly (Next-layer rewrites are
 * unsupported there — route handlers reject them with a 500 and the
 * middleware drops them silently). This handler only runs where those
 * rewrites do not apply: locally the intlMiddleware in proxy.ts handles
 * "/" before a route handler is reached, and on EdgeOne this stays an
 * inert fallback that degrades to a temporary redirect instead of a
 * rewrite.
 *
 * Reading cookies/headers off the request keeps the handler dynamic — it
 * is never prerendered at build time.
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

  return NextResponse.redirect(new URL(`/${locale}/`, request.url));
}
