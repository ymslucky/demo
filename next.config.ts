import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

/**
 * Next.js configuration for EdgeOne Makers deployment.
 *
 * EdgeOne Makers provides zero-config support for Next.js SSR/SSG/ISR.
 * - Build command: `npm run build` (outputs to `.next`)
 * - All Next.js features (App Router, SSR, ISR, Proxy, Image Optimization)
 *   are supported natively without adapters.
 *
 * No `basePath` or `assetPrefix` is needed — EdgeOne serves the app from the
 * root path by default, and all asset paths resolve correctly out of the box.
 *
 * `createNextIntlPlugin` wires the next-intl request config (`i18n/request.ts`)
 * into the build so the production server can resolve message catalogs.
 */
const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default withNextIntl(nextConfig);
