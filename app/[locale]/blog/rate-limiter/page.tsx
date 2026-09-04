import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import PostBody from "./PostBody";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "blog.items.rateLimiter" });
  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function RateLimiterPost({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("blog.items.rateLimiter");

  return (
    <article className="blog-article">
      <Link href="/blog" className="blog-back">
        {t("backToBlog")}
      </Link>

      <header className="blog-header">
        <h1 className="blog-title">
          {t("title")}
        </h1>
        <div className="blog-meta">
          <time>{t("date")}</time>
          <div className="tag-list">
            {(t.raw("tags") as string[]).map((tag) => (
              <span key={tag} className="tag">{tag}</span>
            ))}
          </div>
        </div>
      </header>

      <div className="blog-content">
        <PostBody />
      </div>
    </article>
  );
}
