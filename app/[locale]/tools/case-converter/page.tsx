import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import CaseConverter from "../components/CaseConverter";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "tools" });
  return {
    title: t("items.case.name"),
    description: t("items.case.description"),
  };
}

/** 文本大小写转换工具页。 */
export default async function CaseConverterPage({
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
        <h1 className="tool-page-title">{t("items.case.name")}</h1>
        <p className="tool-page-desc">{t("items.case.description")}</p>
      </header>
      <section className="card tool-page-body">
        <CaseConverter />
      </section>
    </div>
  );
}
