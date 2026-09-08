import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import CounterClient from "./CounterClient";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "tools" });
  return {
    title: t("items.counter.name"),
    description: t("items.counter.description"),
  };
}

/**
 * Real-time counter page (prerendered). The page itself is static; all
 * live data comes from the client component polling /api/counter, and the
 * sign-in gate is rendered by Clerk's <Show> on the client.
 */
export default async function CounterPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  // sr-only title reuses the directory entry copy (tools.items.counter.name).
  const t = await getTranslations("tools");

  return (
    <>
      <h1 className="sr-only">{t("items.counter.name")}</h1>
      <CounterClient />
    </>
  );
}
