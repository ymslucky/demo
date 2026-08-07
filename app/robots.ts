import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: "https://luckylab-demo-qpqxce5k.edgeone.cool/sitemap.xml",
  };
}
