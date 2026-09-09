import type { MetadataRoute } from "next";
import { SITE_URL } from "@/app/lib/site";

// 静态导出要求 metadata 路由显式声明为构建期预渲染。
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
