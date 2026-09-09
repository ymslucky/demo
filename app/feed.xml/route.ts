/**
 * RSS 2.0 订阅源 — /feed.xml
 *
 * 数据源为 app/[locale]/blog/posts.ts 的静态 posts 数组（博客独立
 * 中文内容，按仓库约定豁免于 i18n；其运行时数据进入 XML 属于数据
 * 而非本文件源码字面量）。因此整条路由声明为 force-static，在
 * build 时预渲染成静态 XML 资源。
 */

import { posts } from "@/app/[locale]/blog/posts";
import { SITE_URL } from "@/app/lib/site";

export const dynamic = "force-static";

/** XML 特殊字符转义（& < > " '），先替换 & 避免二次转义。 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** posts.ts 的 date 是 YYYY-MM-DD；转成 RFC-822 合法的 UTC 时间串。 */
function toRfc822(date: string): string {
  return new Date(`${date}T00:00:00Z`).toUTCString();
}

export function GET() {
  const items = posts
    .map((post) => {
      // post.slug 形如 "/blog/rate-limiter"。静态导出 + localePrefix
      // "as-needed" 后，文章（默认语言 zh）位于裸路径，且目录 URL 以
      // / 结尾（对应 out/zh/blog/rate-limiter/index.html）。
      const link = `${SITE_URL}${post.slug}/`;
      return [
        "    <item>",
        `      <title>${escapeXml(post.title)}</title>`,
        `      <link>${escapeXml(link)}</link>`,
        `      <guid>${escapeXml(link)}</guid>`,
        `      <pubDate>${toRfc822(post.date)}</pubDate>`,
        `      <description>${escapeXml(post.description)}</description>`,
        "    </item>",
      ].join("\n");
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>LuckyLab</title>
    <link>${SITE_URL}</link>
    <description>LuckyLab — notes on code and tools</description>
    <language>zh-cn</language>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { "content-type": "application/rss+xml; charset=utf-8" },
  });
}
