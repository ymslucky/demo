import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import RateLimiterDemo from "./RateLimiterDemo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "blog.items.rateLimiter" });
  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function RateLimiterPost({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("blog.items.rateLimiter");

  // Since it's a technical post, we can render the structure directly. 
  // In a real CMS, this would be compiled from MDX.
  return (
    <article className="max-w-3xl mx-auto py-8">
      <Link href="/blog" className="inline-block mb-8 text-sm font-bold opacity-70 hover:opacity-100 transition-opacity">
        ← Back to Blog
      </Link>

      <header className="mb-12">
        <h1 className="text-4xl md:text-5xl font-black mb-4 uppercase tracking-tight" style={{ color: 'var(--color-primary)' }}>
          {t("title")}
        </h1>
        <div className="flex flex-wrap items-center gap-4 mb-6">
          <time className="font-mono text-sm opacity-80">{t("date")}</time>
          <div className="flex gap-2">
            {(t.raw("tags") as string[]).map((tag) => (
              <span key={tag} className="tag">{tag}</span>
            ))}
          </div>
        </div>
        <p className="text-lg opacity-90 leading-relaxed font-medium">
          {t("description")}
        </p>
      </header>

      <div className="prose prose-lg max-w-none" style={{ 
        '--tw-prose-body': 'var(--color-text)',
        '--tw-prose-headings': 'var(--color-text)',
        '--tw-prose-links': 'var(--color-primary)',
        '--tw-prose-bold': 'var(--color-text)',
        '--tw-prose-counters': 'var(--color-text-muted)',
        '--tw-prose-bullets': 'var(--color-text-muted)',
        '--tw-prose-hr': 'var(--color-border)',
        '--tw-prose-quotes': 'var(--color-text)',
        '--tw-prose-quote-borders': 'var(--color-primary)',
        '--tw-prose-captions': 'var(--color-text-muted)',
        '--tw-prose-code': 'var(--color-primary-dark)',
        '--tw-prose-pre-code': 'var(--color-text)',
        '--tw-prose-pre-bg': 'var(--color-surface)',
        '--tw-prose-th-borders': 'var(--color-border)',
        '--tw-prose-td-borders': 'var(--color-border)',
      } as React.CSSProperties}>
        
        <h2 className="text-2xl font-bold mt-10 mb-4 border-b-2 pb-2" style={{ borderColor: 'var(--color-border)' }}>1. 什么是本地限流器？</h2>
        <p className="mb-4">
          高 QPS 的后端服务，几乎一定需要“限流”（Rate Limiting）。这里讨论的是<strong>本地限流器（local rate limiter）</strong>：限流状态只存在于<strong>单个进程/单个实例</strong>中，不和其他实例共享。
        </p>
        <p className="mb-4">
          它的目标很朴素：
        </p>
        <ul className="list-disc pl-6 mb-6 space-y-2">
          <li>在流量突增时保护服务自身（CPU/线程池/DB 连接/下游依赖）</li>
          <li>让系统吞吐更可控，避免被瞬时尖峰打穿</li>
        </ul>

        <h2 className="text-2xl font-bold mt-10 mb-4 border-b-2 pb-2" style={{ borderColor: 'var(--color-border)' }}>2. 令牌桶（Token Bucket）算法</h2>
        <p className="mb-4">
          令牌桶是工程上最常用的一种算法：
        </p>
        <ul className="list-disc pl-6 mb-6 space-y-2">
          <li>桶里有令牌，最大容量为 <code>capacity</code></li>
          <li>系统按固定速率往桶里“补令牌”</li>
          <li>每个请求消耗一个令牌</li>
          <li>没令牌就拒绝（或排队等待）</li>
        </ul>
        <p className="mb-6 font-bold p-4 rounded-md border-2" style={{ backgroundColor: 'var(--color-info-bg)', borderColor: 'var(--color-info-border)', color: 'var(--color-info-text)' }}>
          它和漏桶的区别在于：令牌桶天然允许一定程度的突发（burst）：只要桶里之前攒了令牌，就可以瞬间放行一批。
        </p>

        {/* 交互式演示组件 */}
        <RateLimiterDemo />

        <h2 className="text-2xl font-bold mt-10 mb-4 border-b-2 pb-2" style={{ borderColor: 'var(--color-border)' }}>3. 其他经典算法</h2>
        
        <h3 className="text-xl font-bold mt-6 mb-2">固定窗口（Fixed Window）</h3>
        <p className="mb-4">
          把时间切成一个个固定长度的窗口，每个窗口允许最多 N 次请求。优点是实现简单，缺点是存在<strong>边界突刺</strong>效应，在窗口切换的瞬间可能承受双倍请求。
        </p>

        <h3 className="text-xl font-bold mt-6 mb-2">滑动窗口（Sliding Window）</h3>
        <p className="mb-4">
          记录最近一个窗口大小内的请求时间戳；每次请求进来时，把超过窗口的记录丢掉。更平滑，但需要存储时间戳（内存/CPU 开销较大）。
        </p>

        <h3 className="text-xl font-bold mt-6 mb-2">漏桶（Leaky Bucket）</h3>
        <p className="mb-4">
          把请求想象成倒进桶里的水。桶底部以一个固定速率漏水。它会把突发流量“削峰填谷”，限制的是“处理速率”，而不是“允许速率”。
        </p>
        
        <div className="mt-12 p-6 border-4 rounded-xl" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: 'var(--shadow-md)' }}>
          <h3 className="text-xl font-bold mb-2">总结：什么时候该用哪种？</h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>想要实现简单、开销低：<strong>固定窗口</strong></li>
            <li>想要更严格的速率控制：<strong>滑动窗口</strong></li>
            <li>想要输出速率尽量平滑：<strong>漏桶</strong></li>
            <li>既要限速，又要允许一定突发（最常见）：<strong>令牌桶</strong></li>
          </ul>
        </div>
      </div>
    </article>
  );
}
