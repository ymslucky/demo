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

  return (
    <article className="container" style={{ maxWidth: '800px', paddingTop: 'var(--space-xl)', paddingBottom: 'var(--space-2xl)' }}>
      <Link href="/blog" className="blog-back">
        ← Back to Blog
      </Link>

      <header className="blog-header">
        <h1 className="blog-title">
          {t("title")}
        </h1>
        <div className="blog-meta">
          <time>{t("date")}</time>
          <div className="tag-list" style={{ marginBottom: 0 }}>
            {(t.raw("tags") as string[]).map((tag) => (
              <span key={tag} className="tag">{tag}</span>
            ))}
          </div>
        </div>
      </header>

      <div className="blog-content">
        <p style={{ fontSize: 'var(--fs-xl)', fontWeight: 500, color: 'var(--color-text-muted)', marginBottom: 'var(--space-xl)' }}>
          {t("description")}
        </p>
        
        <h2>0. 为什么我们需要限流器？</h2>
        <p>
          想象一下，你开了一家极度火爆的网红汉堡店。平时店里只有 3 个厨师，每分钟能做 10 个汉堡，生意井井有条。
          突然某天，某位大 V 在社交媒体上推荐了你的店，导致门外瞬间涌来 500 个顾客！
          如果让这 500 个人同时冲进厨房点单，你的厨师会瞬间崩溃，不仅汉堡做不出来，甚至连厨房都可能被砸了。
        </p>
        <p>
          在后端系统中，这就是典型的<strong>突发流量打穿系统</strong>。为了保护我们的服务器（CPU、线程池、数据库连接等）不被瞬间流量压垮，我们需要一个“门卫”——这就是<strong>限流器 (Rate Limiter)</strong>。
          本文主要讨论的是<strong>本地限流器</strong>：即不依赖 Redis，只在当前应用进程内存中生效的限流算法。
        </p>

        <h2>1. 固定窗口 (Fixed Window)</h2>
        <p>
          最直觉的限流方式。就像汉堡店门口的保安，按小时发号：<span className="blog-inline-code">每小时最多只放 100 个人进去</span>。
        </p>
        <p>
          它的实现极度简单：维护一个计数器，到了下一个时间窗口（比如下一个小时的 0 分 0 秒），就把计数器清零。
        </p>

        <pre className="blog-code-block"><code>{`class FixedWindowRateLimiter {
  long windowStart = System.currentTimeMillis();
  int counter = 0;
  final int capacity = 100;
  final long windowSizeMs = 1000;

  synchronized boolean tryAcquire() {
    long now = System.currentTimeMillis();
    // 进入下一个窗口，重置计数器
    if (now - windowStart > windowSizeMs) {
      windowStart = now;
      counter = 0;
    }
    // 尝试放行
    if (counter < capacity) {
      counter++;
      return true;
    }
    return false;
  }
}`}</code></pre>

        <div className="blog-callout">
          <strong>致命缺陷：边界突刺效应。</strong><br/>
          假设限制是每分钟 100 次。在 00:59 的时候，瞬间来了 100 个请求（全部放行）；紧接着 01:00 的时候，窗口刷新，又瞬间来了 100 个请求（也全部放行）。
          结果就是在 00:59 到 01:00 这短短的两秒内，系统承受了 200 个请求的冲击，限流效果大打折扣！
        </div>

        <h2>2. 滑动窗口 (Sliding Window)</h2>
        <p>
          为了解决固定窗口的“突刺”问题，滑动窗口应运而生。它不再切分固定的时间块，而是<strong>随时往回看过去一分钟</strong>的请求量。
          就像保安手里拿着一个精准的秒表，每次有人要进门，他都会翻阅记录本：“过去 60 秒内，进去了多少人？”。
        </p>

        <pre className="blog-code-block"><code>{`class SlidingWindowRateLimiter {
  Queue<Long> requests = new LinkedList<>();
  final int capacity = 100;
  final long windowSizeMs = 1000;

  synchronized boolean tryAcquire() {
    long now = System.currentTimeMillis();
    // 丢弃掉窗口之外的旧记录
    while (!requests.isEmpty() && now - requests.peek() > windowSizeMs) {
      requests.poll();
    }
    // 检查当前窗口内的请求数
    if (requests.size() < capacity) {
      requests.add(now);
      return true;
    }
    return false;
  }
}`}</code></pre>

        <p>
          滑动窗口非常平滑，但代价是<strong>内存开销很大</strong>，因为你需要记录每一个请求的时间戳。对于高并发场景，这个队列会变得非常长，并且清理旧数据的操作也会带来性能损耗。
        </p>

        <h2>3. 漏桶 (Leaky Bucket)</h2>
        <p>
          想象一个底部有小孔的桶，水（请求）以任意速度倒进去，但桶底漏水的速度是<strong>绝对匀速</strong>的。如果倒水的速度太快，桶满了，多余的水就会溢出（请求被拒绝）。
        </p>
        <p>
          漏桶算法的核心目的是<strong>平滑流量</strong>。无论外部流量多么狂暴，系统处理请求的速率始终是一条直线。它非常适合用来保护极其脆弱、一点突发都承受不了的下游系统（比如某些老旧的第三方支付网关）。
        </p>

        <h2>4. 令牌桶 (Token Bucket)</h2>
        <p>
          漏桶虽然平滑，但有时候我们<strong>希望系统能处理一定程度的突发流量</strong>（只要系统当时有空闲）。
          这时候，工程界最受欢迎的算法——<strong>令牌桶</strong>就登场了。
        </p>
        <ul>
          <li>系统以固定的速率向桶里放入“令牌”（Token）。</li>
          <li>桶的容量是有限的（Capacity）。</li>
          <li>每个请求过来时，必须从桶里拿走一个令牌才能被处理。</li>
          <li>如果没有令牌了，请求就被拒绝。</li>
        </ul>

        <p>
          <strong>为什么它能应对突发？</strong> 因为如果之前有一段时间没有请求，桶里就会攒满令牌。这时如果瞬间来了一大波请求，它们可以瞬间把桶里的令牌拿空，从而实现了一次“合法”的突发处理。
        </p>

        {/* 交互式演示组件 */}
        <RateLimiterDemo />

        <p style={{ marginTop: 'var(--space-xl)' }}>
          在真实工程中（如 Guava 的 <span className="blog-inline-code">RateLimiter</span>），令牌桶并不是真的启动一个后台线程去定时发令牌（那样太浪费资源了）。
          而是采用了<strong>惰性计算 (Lazy Computation)</strong>：在每次请求到来时，根据当前时间与上次请求时间的差值，通过数学公式一次性算出“这段时间应该补充多少令牌”。
        </p>

        <pre className="blog-code-block"><code>{`class TokenBucket {
  long lastRefillTime = System.currentTimeMillis();
  double currentTokens = 0;
  final double capacity = 10;
  final double refillRatePerMs = 0.01; // 10 tokens / second

  synchronized boolean tryAcquire() {
    long now = System.currentTimeMillis();
    // 惰性计算：算出距离上次请求，这段时间生成了多少新令牌
    double generatedTokens = (now - lastRefillTime) * refillRatePerMs;
    currentTokens = Math.min(capacity, currentTokens + generatedTokens);
    lastRefillTime = now;

    // 尝试消耗令牌
    if (currentTokens >= 1) {
      currentTokens -= 1;
      return true;
    }
    return false;
  }
}`}</code></pre>
        
        <div className="blog-summary">
          <h3>总结：如何选型？</h3>
          <ul style={{ marginBottom: 0 }}>
            <li>追求绝对简单，且不在乎短时间的流量突刺：<strong>固定窗口</strong></li>
            <li>需要非常严格且平滑的速率控制，且内存预算充足：<strong>滑动窗口</strong></li>
            <li>需要强行将输出速率变为绝对匀速（保护老旧下游）：<strong>漏桶</strong></li>
            <li><strong>最推荐的通用方案</strong>，既能限制平均速率，又允许一定的流量突发：<strong>令牌桶</strong></li>
          </ul>
        </div>
      </div>
    </article>
  );
}