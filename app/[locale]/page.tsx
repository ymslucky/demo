import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import { getContributions, type ContributionsData } from "../lib/contributions";
import ContributionHeatmap from "./components/ContributionHeatmap";

// 贡献数据在服务端每小时刷新一次；浏览器从不在
// 运行时请求它。
export const revalidate = 3600;

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
  const contributions = await getContributions();

  return (
    <>
      <section className="hero">
        <p className="hero-tagline">{t("tagline")}</p>
        <p className="hero-bio">{t("bio")}</p>
      </section>
      <HeatmapSection title={t("heatmap.title")} data={contributions} />
    </>
  );
}

function HeatmapSection({
  title,
  data,
}: {
  title: string;
  data: ContributionsData | null;
}) {
  return (
    <section className="heatmap-section">
      <h2 className="heatmap-title">{title}</h2>
      <ContributionHeatmap data={data} />
    </section>
  );
}