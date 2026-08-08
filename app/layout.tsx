import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Nav from "./components/Nav";
import Footer from "./components/Footer";
import { themeInitScript } from "./lib/theme";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://luckylab-demo-qpqxce5k.edgeone.cool"),
  title: {
    default: "LuckyLab",
    template: "%s · LuckyLab",
  },
  description:
    "LuckyLab — 独立开发者，专注于 Web 应用与自动化工具的全栈开发。",
  icons: {
    icon: "/favicon.svg",
  },
  authors: [{ name: "LuckyLab" }],
  openGraph: {
    type: "website",
    siteName: "LuckyLab",
    locale: "zh_CN",
    images: ["/og-image.png"],
  },
  twitter: {
    card: "summary",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={inter.variable} suppressHydrationWarning>
      <body>
        {/* 首帧前同步应用主题，避免主题闪烁 (FOUC) */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript() }} />
        <div className="page">
          <Nav />
          <main>
            <div className="container">{children}</div>
          </main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
