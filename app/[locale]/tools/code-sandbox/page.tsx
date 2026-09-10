import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import CodeSandboxClient from "./CodeSandboxClient";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "tools" });
  return {
    title: t("items.sandbox.name"),
    description: t("items.sandbox.description"),
  };
}

/**
 * Code Sandbox page (prerendered). The page itself is static; all sandbox
 * execution happens in the client component talking to the /code-run
 * Makers agent endpoint (EdgeOne sandbox lives behind it).
 */
export default async function CodeSandboxPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  // sr-only title reuses the directory entry copy (tools.items.sandbox.name).
  const t = await getTranslations("tools");

  return (
    <>
      <h1 className="sr-only">{t("items.sandbox.name")}</h1>
      <CodeSandboxClient />
    </>
  );
}
