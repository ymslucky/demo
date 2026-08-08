import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link, getPathname } from "@/i18n/navigation";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "home" });
  return {
    title: {
      absolute: t("title"),
    },
    description: t("description"),
    alternates: {
      canonical: getPathname({ locale, href: "/" }),
    },
  };
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");

  return (
    <section className="hero">
      <p className="hero-tagline">{t("tagline")}</p>
      <p className="hero-bio">{t("bio")}</p>
      <div className="hero-cta">
        <Link href="/projects" className="btn btn--primary">
          {t("viewProjects")}
        </Link>
        <Link href="/about" className="btn btn--secondary">
          {t("learnMore")}
        </Link>
      </div>
    </section>
  );
}
