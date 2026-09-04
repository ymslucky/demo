import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Code2, ExternalLink } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Badge, Card } from "../components/ui";

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

interface ProjectItem {
  key: string;
  name: string;
  description: string;
  tags: string[];
  demo: string | null;
  repo: string;
}

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

  const items: ProjectItem[] = projects.map((project) => ({
    key: project.key,
    name: t(`items.${project.key}.name`),
    description: t(`items.${project.key}.description`),
    tags: t.raw(`items.${project.key}.tags`) as string[],
    demo: project.demo,
    repo: project.repo,
  }));

  return (
    <>
      <h1 className="sr-only">{t("heading")}</h1>

      <div className="bento">
        {items.map((item, i) => (
          <Card key={item.key} as="article" className="bento-card">
            <span className="bento-index" aria-hidden="true">
              {String(i + 1).padStart(2, "0")}
            </span>
            <h3>
              <a href={item.repo} target="_blank" rel="noopener noreferrer">
                {item.name}
              </a>
            </h3>
            <p>{item.description}</p>
            <div className="tag-list">
              {item.tags.map((tag) => (
                <span key={tag} className="tag">
                  {tag}
                </span>
              ))}
            </div>
            <div className="project-links">
              {item.demo && (
                <a
                  className="icon-link"
                  href={item.demo}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={t("demo")}
                  aria-label={`${item.name} ${t("demo")}`}
                >
                  <ExternalLink size={22} strokeWidth={2.5} />
                </a>
              )}
              <a
                className="icon-link"
                href={item.repo}
                target="_blank"
                rel="noopener noreferrer"
                title={t("source")}
                aria-label={`${item.name} ${t("source")}`}
              >
                <Code2 size={22} strokeWidth={2.5} />
              </a>
            </div>
          </Card>
        ))}
      </div>

      <section className="projects-outro">
        <h2>{t("outroTitle")}</h2>
        <div className="cta-row">
          <a
            className="btn btn--primary"
            href="https://github.com/ymslucky"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Code2 size={20} strokeWidth={2.5} />
            {t("githubCta")}
          </a>
          <Link className="btn btn--secondary" href="/contact" prefetch={false}>
            {t("contactCta")}
          </Link>
        </div>
      </section>
    </>
  );
}
