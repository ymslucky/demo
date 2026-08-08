import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import ToolsClient from "./ToolsClient";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "tools" });
  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function ToolsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("tools");

  return (
    <>
      <h1 className="page-title">{t("heading")}</h1>
      <p className="page-subtitle">{t("subtitle")}</p>
      <ToolsClient />
    </>
  );
}
