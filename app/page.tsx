import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    absolute: "LuckyLab — 独立开发者 · 全栈开发与自动化工具",
  },
  description:
    "LuckyLab，独立开发者，专注于 Web 应用与自动化工具的全栈开发。Next.js、Python、Serverless 快速搭建解决实际问题的小工具。",
  alternates: {
    canonical: "/",
  },
};

export default function HomePage() {
  return (
    <section className="hero">
      <p className="hero-tagline">用代码把想法变成产品。</p>
      <p className="hero-bio">
        独立开发者，专注于 Web 应用与自动化工具的全栈开发。喜欢用 Next.js 和
        Python 快速搭建解决实际问题的小工具，从节假日日历到 Serverless
        函数平台都有涉猎。
      </p>
      <div className="hero-cta">
        <Link href="/projects" className="btn btn--primary">
          查看项目
        </Link>
        <Link href="/about" className="btn btn--secondary">
          了解更多
        </Link>
      </div>
    </section>
  );
}
