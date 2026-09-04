import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { posts } from "../posts";
import PostBody from "./PostBody";

type PostParams = { params: Promise<{ locale: string }> };

const post = posts.find((p) => p.id === "rateLimiter");

export async function generateMetadata({
  params,
}: PostParams): Promise<Metadata> {
  await params;
  // Article metadata is content, not UI copy — not part of i18n catalogs.
  return {
    title: post?.title,
    description: post?.description,
  };
}

export default async function RateLimiterPost({ params }: PostParams) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("blog");
  if (!post) notFound();

  return (
    <article className="blog-article">
      <Link href="/blog" className="blog-back">
        {t("backToBlog")}
      </Link>

      <header className="blog-header">
        <h1 className="blog-title">{post.title}</h1>
        <div className="blog-meta">
          <time>{post.date}</time>
          <div className="tag-list">
            {post.tags.map((tag) => (
              <span key={tag} className="tag">
                {tag}
              </span>
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
