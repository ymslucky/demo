import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import "../globals.css";
import Nav from "./components/Nav";
import Footer from "./components/Footer";
import ThemeSync from "./components/ThemeSync";

// 省略 `weight` 会加载 Inter 的可变字体文件（一个 woff2 覆盖
// 100-900），而不是四个按字重拆分的静态文件 — 请求数更少，并且
// 800/900 这类 font-weight 值会渲染出真实字形，而非伪粗体。
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata" });

  return {
    metadataBase: new URL("https://luckylab-demo-qpqxce5k.edgeone.cool"),
    title: {
      default: t("title"),
      template: t("template"),
    },
    description: t("description"),
    icons: {
      icon: "/favicon.svg",
    },
    authors: [{ name: "LuckyLab" }],
    openGraph: {
      type: "website",
      siteName: "LuckyLab",
      locale: locale === "zh" ? "zh_CN" : "en_US",
      images: ["/og-image.png"],
    },
    twitter: {
      card: "summary",
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  // 为所有已配置的 locale 启用静态渲染。
  setRequestLocale(locale);

  // 显式传入 messages + locale，使客户端 hydration 不依赖隐式的服务端
  // request-config 缓存（当某个页面在 provider 读取之前，先在本次请求上调用了
  // `headers()` 时，该缓存会失效 —— react cache 对 `headers()` 读取的
  // 作用域在不同 server components 之间并不相同）。
  // 显式 messages prop 参见 next-intl `getRequestConfig` 文档。
  const messages = await getMessages();
  const t = await getTranslations("nav");

  return (
    <html
      lang={locale}
      className={inter.variable}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <body>
        {/* 绘制前的主题同步脚本由 middleware.ts 在 HTTP 层注入到 HTML 的
            head 中，处于 React 组件树之外（原理与约束见 AGENTS.md §3），
            此处刻意不渲染任何脚本节点 —— React 19 会对客户端渲染出的
            script 节点告警。html 上的 suppressHydrationWarning 用于压掉
            data-theme 在 hydration 前被提前设置导致的属性不匹配告警。 */}
        <NextIntlClientProvider messages={messages} locale={locale}>
          <ThemeSync />
          <div className="page">
            <a className="skip-link" href="#main-content">
              {t("skipToContent")}
            </a>
            <Nav />
            <main id="main-content" tabIndex={-1}>
              <div className="container">{children}</div>
            </main>
            <Footer />
          </div>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
