import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "blog" });
  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function BlogPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("blog");

  const posts = [
    {
      id: "rateLimiter",
      slug: "/blog/rate-limiter",
    },
  ];

  return (
    <>
      <h1 className="page-title">{t("heading")}</h1>
      <p className="page-subtitle">{t("subtitle")}</p>

      <div className="card-grid">
        {posts.map((post) => {
          const tags = t.raw(`items.${post.id}.tags`) as string[];
          return (
            <article key={post.id} className="card project-card">
              <h3>
                <Link href={post.slug}>{t(`items.${post.id}.title`)}</Link>
              </h3>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>
                {t(`items.${post.id}.date`)}
              </p>
              <p>{t(`items.${post.id}.description`)}</p>
              <div className="tag-list" style={{ marginTop: 'var(--space-sm)' }}>
                {tags.map((tag) => (
                  <span key={tag} className="tag">
                    {tag}
                  </span>
                ))}
              </div>
              <div className="project-links" style={{ marginTop: 'var(--space-md)' }}>
                <Link href={post.slug} className="btn btn--primary btn--sm">
                  {t("readMore")}
                </Link>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
