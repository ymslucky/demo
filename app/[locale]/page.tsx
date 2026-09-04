import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import ImmersiveLink from "./components/ImmersiveLink";
import ContributionHeatmap from "./components/ContributionHeatmap";

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
    <>
      <section className="hero">
        <p className="hero-tagline">{t("tagline")}</p>
        <p className="hero-bio">{t("bio")}</p>
        <div className="hero-cta">
          <ImmersiveLink href="/projects" className="btn btn--primary">
            {t("viewProjects")}
          </ImmersiveLink>
          <ImmersiveLink href="/about" className="btn btn--secondary">
            {t("learnMore")}
          </ImmersiveLink>
        </div>
      </section>
      <HeatmapSection title={t("heatmap.title")} subtitle={t("heatmap.subtitle")} />
    </>
  );
}

function HeatmapSection({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <section className="heatmap-section">
      <h2 className="heatmap-title">{title}</h2>
      <p className="heatmap-subtitle">{subtitle}</p>
      <ContributionHeatmap />
    </section>
  );
}