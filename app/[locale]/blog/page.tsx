import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Badge, Card } from "../components/ui";
import { posts } from "./posts";

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

  return (
    <>
      <h1 className="sr-only">{t("heading")}</h1>

      <div className="card-grid">
        {posts.map((post) => (
          <Card key={post.id} as="article" className="project-card">
            <h3>
              <Link href={post.slug}>{post.title}</Link>
            </h3>
            <p className="blog-card-date">{post.date}</p>
            <p>{post.description}</p>
            <div className="tag-list blog-card-tags">
              {post.tags.map((tag) => (
                <Badge key={tag}>{tag}</Badge>
              ))}
            </div>
            <div className="project-links blog-card-links">
              <Link href={post.slug} className="btn btn--primary btn--sm">
                {t("readMore")}
              </Link>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
