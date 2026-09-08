import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

/**
 * Next.js configuration — hybrid architecture (SSR + EdgeOne edge functions).
 *
 * The app runs as a standard Next.js server (SSR) so request-time rendering
 * and authentication (Clerk) are available. Legacy static-deployment settings
 * are kept where they don't get in the way:
 *
 * - `trailingSlash: true` keeps every URL in the directory form
 *   (`/zh/about/`), matching the historical static deployment and the
 *   EdgeOne redirect table in `edgeone.json`.
 * - `images.unoptimized` keeps `<img>` URLs as authored — no image-optimizer
 *   infrastructure is required (useful on hosts that don't provide one).
 *
 * `createNextIntlPlugin` wires the next-intl request config (`i18n/request.ts`)
 * into the build so message catalogs resolve per request.
 */
const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  trailingSlash: true,
  images: { unoptimized: true },
};

export default withNextIntl(nextConfig);
