import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://luckylab-demo-qpqxce5k.edgeone.cool";
  const lastModified = new Date();

  const paths: Array<{
    path: string;
    changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
    priority: number;
  }> = [
    { path: "", changeFrequency: "monthly", priority: 1.0 },
    { path: "/about", changeFrequency: "monthly", priority: 0.8 },
    { path: "/projects", changeFrequency: "monthly", priority: 0.8 },
    { path: "/tools", changeFrequency: "yearly", priority: 0.6 },
    { path: "/links", changeFrequency: "monthly", priority: 0.5 },
    { path: "/contact", changeFrequency: "yearly", priority: 0.5 },
  ];

  // The default locale (zh) is served unprefixed; other locales get a prefix.
  return paths.flatMap(({ path, changeFrequency, priority }) =>
    routing.locales.map((locale) => ({
      url: `${baseUrl}${locale === routing.defaultLocale ? "" : `/${locale}`}${path}`,
      lastModified,
      changeFrequency,
      priority,
    })),
  );
}
