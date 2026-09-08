import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import HttpCheckClient from "./HttpCheckClient";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "tools" });
  return {
    title: t("items.httpCheck.name"),
    description: t("items.httpCheck.description"),
  };
}

/**
 * HTTP 请求体检页（纯静态）。
 *
 * 页面本体不再读取请求头 —— `headers()` 依赖已移除，因此可以
 * 静态渲染并享受 CDN 边缘缓存；"服务器视角"的实时数据改由
 * 客户端组件 HttpCheckClient 在浏览器端 fetch `/api/headers` 获取。
 */
export default async function HttpCheckPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  // sr-only 标题沿用目录条目文案（`tools.items.httpCheck.name`）。
  const t = await getTranslations("tools");

  return (
    <>
      <h1 className="sr-only">{t("items.httpCheck.name")}</h1>
      <HttpCheckClient />
    </>
  );
}
