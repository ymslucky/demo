import { NextResponse } from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";
import createIntlMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

/**
 * Next.js 16 proxy (successor to middleware.ts).
 *
 * Responsibilities, in order:
 * 1. `clerkMiddleware` — refreshes session tokens and makes auth state
 *    available (the wrapper is required for Clerk request decoration; the
 *    EdgeOne adapter does not propagate it into SSR, which is why
 *    app/lib/session.ts verifies the session cookie directly).
 * 2. Locale channel selection:
 *    - Requests that already carry a locale prefix (`/zh/…`, `/en/…`) are
 *      passed straight through. Under `localePrefix: "as-needed"` the
 *      default-locale prefix is redundant, and passing them to
 *      `intlMiddleware` would make it strip the prefix with a 307 —
 *      but the EdgeOne edge rewrites (edgeone.json) map bare paths back
 *      to `/zh/…`, so strip ↔ rewrite ping-pongs forever and prefixed
 *      URLs (e.g. the /admin rewrite target) never render. Prefixed
 *      paths need no negotiation: `app/[locale]` resolves the locale
 *      from the URL segment.
 *    - Bare paths go through `intlMiddleware` (`as-needed`): locally it
 *      rewrites to the `/zh/…` route (NEXT_LOCALE cookie →
 *      Accept-Language weights → default zh); in EdgeOne production the
 *      middleware rewrite is dropped by the adapter and the edge
 *      rewrites in `edgeone.json` take over instead.
 *
 * All routes are public by default; protect specific routes with
 * `createRouteMatcher` + `auth.protect()` when needed.
 */

const intlMiddleware = createIntlMiddleware(routing);

const DEFAULT_LOCALE_PREFIX = new RegExp(`^\\/${routing.defaultLocale}(?:\\/|$)`);

export default clerkMiddleware(async (_auth, request) => {
  if (DEFAULT_LOCALE_PREFIX.test(new URL(request.url).pathname)) {
    return NextResponse.next();
  }
  return intlMiddleware(request);
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
    // Clerk auto-proxy path
    "/__clerk/:path*",
  ],
};
