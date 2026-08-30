import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { themeInitScript } from "./app/lib/theme";

const intlMiddleware = createIntlMiddleware(routing);

/**
 * Wraps next-intl's middleware so we can post-process the HTML response.
 *
 * WHY NOT PUT THE SCRIPT IN JSX: React 19 emits a console warning whenever a
 * <script> element is rendered as part of any component's VDOM output ("Script
 * inside React components is never executed on the client"), even if Next.js
 * would otherwise hoist the tag to <head>. The warning fires on every
 * client-side navigation (e.g. zh <-> en locale switch) because the layout
 * re-renders in the browser.
 *
 * To silence it while keeping the pre-paint anti-FOUC guarantee, we inject
 * the theme-init <script> directly into the streamed HTML at the HTTP layer,
 * BEFORE React ever sees it. The script is the exact same self-contained
 * snippet produced by app/lib/theme.ts:themeInitScript().
 */
export default async function middleware(request: NextRequest) {
  const response = (await intlMiddleware(request)) as NextResponse;

  const contentType =
    response.headers.get("content-type") ??
    // If next-intl returned an "empty" rewrite/redirect with no body yet, fall
    // back to the request's Accept header: browsers ask for text/html for page
    // navigations, not for RSC / static payloads.
    (request.headers.get("accept")?.includes("text/html") ? "text/html" : "");

  if (!contentType.startsWith("text/html")) {
    return response;
  }

  // Non-OK / non-body responses (redirects, rewrites without body, ...) don't
  // have HTML to patch and pass through untouched.
  if (!response.body || (response.status >= 300 && response.status < 400)) {
    return response;
  }

  const script = `<script>${themeInitScript()}</script>`;
  const origBody = await response.text();

  // Prefer injecting inside <head> so the script runs as early as possible
  // (before the <body> is even parsed -> truly zero FOUC chance). Fall back
  // to the very start of <body> if the head marker is missing for any reason.
  let newBody: string;
  const headIdx = origBody.indexOf("<head>");
  if (headIdx >= 0) {
    newBody =
      origBody.slice(0, headIdx + "<head>".length) +
      script +
      origBody.slice(headIdx + "<head>".length);
  } else {
    const bodyIdx = origBody.indexOf("<body");
    if (bodyIdx >= 0) {
      const close = origBody.indexOf(">", bodyIdx);
      if (close >= 0) {
        newBody =
          origBody.slice(0, close + 1) + script + origBody.slice(close + 1);
      } else {
        newBody = script + origBody;
      }
    } else {
      newBody = script + origBody;
    }
  }

  const headers = new Headers(response.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  // Content-Length is only set when we know the exact byte length; otherwise
  // Next's response pipeline falls back to Transfer-Encoding: chunked.
  const byteLen = new TextEncoder().encode(newBody).byteLength;
  if (headers.has("content-length")) {
    headers.set("content-length", String(byteLen));
  }

  return new NextResponse(newBody, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const config = {
  // Skip API routes, Next.js internals and files with extensions.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
