import type { Metadata } from "next";
import "./globals.css";
import Nav from "./components/Nav";
import Footer from "./components/Footer";

export const metadata: Metadata = {
  metadataBase: new URL("https://luckylab.dev"),
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
    <html lang="zh-CN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <meta name="theme-color" content="#4f46e5" />
      </head>
      <body>
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
