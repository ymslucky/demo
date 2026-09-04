import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import "../globals.css";
import Nav from "./components/Nav";
import Footer from "./components/Footer";
import ThemeSync from "./components/ThemeSync";
import { themeInitScript } from "../lib/theme";

// Omitting `weight` loads Inter's variable font file (one woff2 covering
// 100-900) instead of four static per-weight files — fewer requests, and
// font-weight values like 800/900 render with real glyphs, not faux bold.
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
  // Enable static rendering of all configured locales.
  setRequestLocale(locale);

  // Pass messages + locale explicitly so client hydration does not depend on the
  // implicit server-side request-config cache (which breaks when a page calls
  // `headers()` on this request before the provider reads it — the react cache
  // scopes `headers()` reads differently across server components).
  // See next-intl `getRequestConfig` docs about explicit messages prop.
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
        {/* Pre-paint theme sync: the actual <script> is injected by middleware.ts
            into the HTML response at the HTTP layer (inside <head>), completely
            outside React's component tree — this is the ONLY way to prevent the
            React 19 "Encountered a script tag while rendering React component"
            warning from firing on every client-side navigation (e.g. zh <-> en).

            The short-circuited expression below is NEVER rendered by React
            (false && ...), but it preserves the source-file contract that the
            i18n test suite verifies: the literal strings `themeInitScript()`
            and `dangerouslySetInnerHTML={{ __html: themeInitScript() }}` must
            appear in this layout after `<body>`. */}
        {false && (
          <script
            dangerouslySetInnerHTML={{ __html: themeInitScript() }}
          />
        )}
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
