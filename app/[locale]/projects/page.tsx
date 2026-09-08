import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Badge, Card } from "../components/ui";

interface IconProps {
  size?: number;
}

/** 通用 SVG 骨架：24 网格描边风格，颜色继承 currentColor（替代 lucide-react，零依赖）。 */
function Svg({ size = 24, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

function ExternalLinkIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </Svg>
  );
}

function Code2Icon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="m18 16 4-4-4-4" />
      <path d="m6 8-4 4 4 4" />
      <path d="m14.5 4-5 16" />
    </Svg>
  );
}

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
                  <ExternalLinkIcon size={22} />
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
                <Code2Icon size={22} />
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
            <Code2Icon size={20} />
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
