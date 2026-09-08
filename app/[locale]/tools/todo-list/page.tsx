import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import TodoClient from "./TodoClient";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "tools" });
  return {
    title: t("items.todo.name"),
    description: t("items.todo.description"),
  };
}

/**
 * TODO List page (prerendered). The page itself is static; all list data
 * comes from the client component talking to /api/todo, and the sign-in
 * gate is rendered by Clerk's <Show> on the client.
 */
export default async function TodoPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  // sr-only title reuses the directory entry copy (tools.items.todo.name).
  const t = await getTranslations("tools");

  return (
    <>
      <h1 className="sr-only">{t("items.todo.name")}</h1>
      <TodoClient />
    </>
  );
}
