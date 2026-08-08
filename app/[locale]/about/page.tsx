import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "about" });
  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("about");
  const focusAreas = t.raw("focusAreas") as string[];

  return (
    <>
      <h1 className="page-title">{t("heading")}</h1>
      <p className="page-subtitle">{t("subtitle")}</p>

      <div className="about-text">
        <p>{t("p1")}</p>
        <p>{t("p2")}</p>
        <p>{t("p3")}</p>
      </div>

      <div className="about-focus">
        <h2>{t("focusTitle")}</h2>
        <div className="focus-tags">
          {focusAreas.map((area) => (
            <span key={area} className="focus-tag">
              {area}
            </span>
          ))}
        </div>
      </div>

      <div className="about-honor">{t("honor")}</div>
    </>
  );
}
