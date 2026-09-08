import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import JsonFormatter from "../components/JsonFormatter";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "tools" });
  return {
    title: t("items.json.name"),
    description: t("items.json.description"),
  };
}

/** JSON 格式化工具页 —— 具体使用收敛到二级页面，首页只做陈列。 */
export default async function JsonFormatterPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("tools");

  return (
    <div className="tool-page">
      <Link href="/tools" className="tool-back" prefetch={false}>
        ← {t("title")}
      </Link>
      <header className="tool-page-header">
        <h1 className="tool-page-title">{t("items.json.name")}</h1>
        <p className="tool-page-desc">{t("items.json.description")}</p>
      </header>
      <section className="card tool-page-body">
        <JsonFormatter />
      </section>
    </div>
  );
}
