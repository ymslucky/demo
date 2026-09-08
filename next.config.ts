import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

/**
 * Next.js configuration — full static export for EdgeOne Pages.
 *
 * The site ships as pure static files (`out/`) served by the EdgeOne CDN.
 * All dynamic behaviour (locale negotiation at `/`, presence, GitHub stars,
 * request inspection) is implemented as EdgeOne Pages edge functions in
 * `functions/` — Next.js renders nothing at request time.
 *
 * - `output: "export"` produces the static `out/` directory.
 * - `trailingSlash: true` makes every page resolve to a real `index.html`
 *   inside a directory (e.g. `out/zh/about/index.html`), which is what the
 *   CDN needs to serve `/zh/about/` directly.
 * - `images.unoptimized` is required by static export (no image optimizer
 *   server exists); `<img>` URLs stay as authored.
 *
 * `createNextIntlPlugin` wires the next-intl request config (`i18n/request.ts`)
 * into the build so message catalogs resolve at build time.
 */
const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default withNextIntl(nextConfig);
