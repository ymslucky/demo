/**
 * 博客文章目录——独立成篇的中文内容，刻意不纳入 i18n 文案目录。
 * 无论 UI 语言（locale）为何，文章一律以中文撰写；tests/i18n.test.ts
 * 正是基于这一原因，将本目录豁免于源码禁用 CJK 的约定。
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
