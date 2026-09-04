/**
 * Blog post catalogue — standalone Chinese content, deliberately NOT part of
 * the i18n message catalogs. Articles are written in Chinese regardless of
 * the UI locale; tests/i18n.test.ts exempts this directory from the
 * no-CJK-in-source contract for exactly this reason.
 */
export type BlogPost = {
  id: string;
  slug: string;
  title: string;
  description: string;
  date: string;
  tags: string[];
};

export const posts: BlogPost[] = [
  {
    id: "rateLimiter",
    slug: "/blog/rate-limiter",
    title: "本地限流器的形式化分析：从固定窗口到令牌桶",
    description:
      "以论文体例重构：在统一数学框架下分析固定窗口、滑动窗口日志、漏桶（GCRA）与令牌桶，含定理证明、复杂度对比表、交互仿真与 11 篇参考文献。",
    date: "2023-12-29",
    tags: ["论文", "限流", "网络演算"],
  },
];
