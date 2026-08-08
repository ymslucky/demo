import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

/**
 * next-intl middleware — negotiates the locale from the URL and routes
 * `/en/...` to the English locale while keeping the default (zh) unprefixed.
 */
export default createMiddleware(routing);

export const config = {
  // Skip API routes, Next.js internals and files with extensions.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
