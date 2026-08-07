import type { NextConfig } from "next";

/**
 * Next.js configuration for EdgeOne Makers deployment.
 *
 * EdgeOne Makers provides zero-config support for Next.js SSR/SSG/ISR.
 * - Build command: `npm run build` (outputs to `.next`)
 * - All Next.js features (App Router, SSR, ISR, Middleware, Image Optimization)
 *   are supported natively without adapters.
 *
 * No `basePath` or `assetPrefix` is needed — EdgeOne serves the app from the
 * root path by default, and all asset paths resolve correctly out of the box.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
