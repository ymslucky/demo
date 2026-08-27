import { extractClientIp } from "@/app/[locale]/tools/http-check/utils";

/**
 * JSON echo endpoint — the data source of the HTTP check tool.
 *
 * Returns everything the server saw: IP, method, URL, time and full headers.
 * Accepts GET / POST (and any other method) so the site doubles as a
 * debugging echo loop.
 */

/** Depends on request context, so it must run dynamically on every call. */
export const dynamic = "force-dynamic";

function echo(request: Request) {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const url = new URL(request.url);
  return Response.json(
    {
      ok: true,
      method: request.method,
      host: url.host,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      receivedAt: new Date().toISOString(),
      clientIp: extractClientIp(headers),
      userAgent: headers["user-agent"] ?? null,
      // Sort headers by name so they are easy to scan by eye.
      headers: Object.fromEntries(Object.entries(headers).sort(([a], [b]) => a.localeCompare(b))),
    },
    { headers: { "cache-control": "no-store" } }
  );
}

export const GET = echo;
export const POST = echo;
