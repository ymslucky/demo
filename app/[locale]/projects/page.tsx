import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

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

  return (
    <>
      <h1 className="page-title">{t("heading")}</h1>
      <p className="page-subtitle">{t("subtitle")}</p>

      <div className="card-grid">
        {projects.map((project) => {
          const tags = t.raw(`items.${project.key}.tags`) as string[];
          return (
            <article key={project.repo} className="card project-card">
              <h3>
                <a
                  href={project.repo}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t(`items.${project.key}.name`)}
                </a>
              </h3>
              <p>{t(`items.${project.key}.description`)}</p>
              <div className="tag-list">
                {tags.map((tag) => (
                  <span key={tag} className="tag">
                    {tag}
                  </span>
                ))}
              </div>
              <div className="project-links">
                {project.demo && (
                  <a
                    href={project.demo}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("demo")}
                  </a>
                )}
                <a
                  href={project.repo}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("source")}
                </a>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
