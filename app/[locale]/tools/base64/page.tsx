import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import Base64Tool from "../components/Base64Tool";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "tools" });
  return {
    title: t("items.base64.name"),
    description: t("items.base64.description"),
  };
}

/** Base64 编解码工具页。 */
export default async function Base64Page({
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
        <h1 className="tool-page-title">{t("items.base64.name")}</h1>
        <p className="tool-page-desc">{t("items.base64.description")}</p>
      </header>
      <section className="card tool-page-body">
        <Base64Tool />
      </section>
    </div>
  );
}
