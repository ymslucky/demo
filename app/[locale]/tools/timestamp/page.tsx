import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import TimestampTool from "../components/TimestampTool";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "tools" });
  return {
    title: t("items.timestamp.name"),
    description: t("items.timestamp.description"),
  };
}

/** 时间戳转换工具页。 */
export default async function TimestampPage({
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
        <h1 className="tool-page-title">{t("items.timestamp.name")}</h1>
        <p className="tool-page-desc">{t("items.timestamp.description")}</p>
      </header>
      <section className="card tool-page-body">
        <TimestampTool />
      </section>
    </div>
  );
}
