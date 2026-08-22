import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { WallItem } from "./components/CardWall3D";
import ProjectsClient from "./ProjectsClient";

interface Project {
  key: string;
  demo: string | null;
  repo: string;
}

const projects: Project[] = [
  {
    key: "holiday",
    demo: "https://holiday.meta-p.com",
    repo: "https://github.com/ymslucky/holiday",
  },
  {
    key: "functionstore",
    demo: null,
    repo: "https://github.com/ymslucky/FunctionStore",
  },
  {
    key: "dateview",
    demo: null,
    repo: "https://github.com/ymslucky/DateView",
  },
  {
    key: "fnav",
    demo: null,
    repo: "https://github.com/ymslucky/FNav",
  },
  {
    key: "autotask",
    demo: null,
    repo: "https://github.com/ymslucky/AutoTask-UI-",
  },
  {
    key: "bitresonance",
    demo: null,
    repo: "https://github.com/ymslucky/BitResonance",
  },
];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "projects" });
  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function ProjectsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("projects");

  const items: WallItem[] = projects.map((project) => ({
    key: project.key,
    name: t(`items.${project.key}.name`),
    description: t(`items.${project.key}.description`),
    tags: t.raw(`items.${project.key}.tags`) as string[],
    demo: project.demo,
    repo: project.repo,
  }));

  return (
    <ProjectsClient
      heading={t("heading")}
      subtitle={t("subtitle")}
      items={items}
      labels={{ demo: t("demo"), source: t("source") }}
    />
  );
}
