import { clerkMiddleware } from "@clerk/nextjs/server";
import createIntlMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

/**
 * Next.js 16 proxy (successor to middleware.ts).
 *
 * Two responsibilities composed in order:
 * 1. `clerkMiddleware` — refreshes session tokens and makes auth state
 *    available to server components via `auth()`.
 * 2. `intlMiddleware` — next-intl locale negotiation (`localePrefix:
 *    "always"`): unprefixed URLs like `/` get 302'd to `/zh/…` or `/en/…`
 *    (NEXT_LOCALE cookie → Accept-Language weights → default zh). This
 *    replaces the legacy root-path 302 that used to live in
 *    `functions/index.js`.
 *
 * All routes are public by default; protect specific routes with
 * `createRouteMatcher` + `auth.protect()` when needed.
 */
const intlMiddleware = createIntlMiddleware(routing);

export default clerkMiddleware(async (_auth, request) => {
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
