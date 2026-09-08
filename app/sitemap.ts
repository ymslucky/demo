import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";

// 静态导出要求 metadata 路由显式声明为构建期预渲染。
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://luckylab-demo-qpqxce5k.edgeone.cool";
  const lastModified = new Date();

  const paths: Array<{
    path: string;
    changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
    priority: number;
  }> = [
    { path: "", changeFrequency: "monthly", priority: 1.0 },
    { path: "/blog", changeFrequency: "monthly", priority: 0.7 },
    { path: "/blog/rate-limiter", changeFrequency: "monthly", priority: 0.7 },
    { path: "/tools", changeFrequency: "yearly", priority: 0.6 },
    { path: "/tools/json-formatter", changeFrequency: "monthly", priority: 0.6 },
    { path: "/tools/base64", changeFrequency: "monthly", priority: 0.6 },
    { path: "/tools/timestamp", changeFrequency: "monthly", priority: 0.6 },
    { path: "/tools/unit-converter", changeFrequency: "monthly", priority: 0.6 },
    { path: "/tools/color-picker", changeFrequency: "monthly", priority: 0.6 },
    { path: "/tools/case-converter", changeFrequency: "monthly", priority: 0.6 },
    { path: "/tools/http-check", changeFrequency: "monthly", priority: 0.6 },
    { path: "/tools/counter", changeFrequency: "monthly", priority: 0.6 },
    { path: "/links", changeFrequency: "monthly", priority: 0.5 },
    { path: "/contact", changeFrequency: "yearly", priority: 0.5 },
  ];

  // localePrefix "always" + trailingSlash：每个 URL 都带 locale 前缀、
  // 以 / 结尾（对应 out/<locale>/<path>/index.html 的静态产物）。
  return paths.flatMap(({ path, changeFrequency, priority }) =>
    routing.locales.map((locale) => ({
      url: `${baseUrl}/${locale}${path}/`,
      lastModified,
      changeFrequency,
      priority,
    })),
  );
}
