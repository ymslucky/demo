import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

interface LinkItem {
  key: string;
  url: string;
}

interface LinkCategory {
  key: string;
  emoji: string;
  links: LinkItem[];
}

const categories: LinkCategory[] = [
  {
    key: "cloud",
    emoji: "☁️",
    links: [
      { key: "aws", url: "https://aws.amazon.com" },
      { key: "azure", url: "https://azure.microsoft.com" },
      { key: "gcp", url: "https://cloud.google.com" },
      { key: "aliyun", url: "https://www.aliyun.com" },
      { key: "tencent", url: "https://cloud.tencent.com" },
      { key: "huawei", url: "https://www.huaweicloud.com" },
      { key: "cloudflare", url: "https://www.cloudflare.com" },
      { key: "vercel", url: "https://vercel.com" },
    ],
  },
  {
    key: "dev",
    emoji: "📦",
    links: [
      { key: "github", url: "https://github.com" },
      { key: "gitlab", url: "https://gitlab.com" },
      { key: "stackoverflow", url: "https://stackoverflow.com" },
      { key: "mdn", url: "https://developer.mozilla.org" },
      { key: "npm", url: "https://www.npmjs.com" },
      { key: "devdocs", url: "https://devdocs.io" },
      { key: "caniuse", url: "https://caniuse.com" },
      { key: "regex101", url: "https://regex101.com" },
    ],
  },
  {
    key: "frontend",
    emoji: "⚡",
    links: [
      { key: "react", url: "https://react.dev" },
      { key: "vue", url: "https://vuejs.org" },
      { key: "astro", url: "https://astro.build" },
      { key: "nextjs", url: "https://nextjs.org" },
      { key: "svelte", url: "https://svelte.dev" },
      { key: "tailwind", url: "https://tailwindcss.com" },
      { key: "vite", url: "https://vitejs.dev" },
      { key: "typescript", url: "https://www.typescriptlang.org" },
    ],
  },
  {
    key: "design",
    emoji: "🎨",
    links: [
      { key: "figma", url: "https://www.figma.com" },
      { key: "dribbble", url: "https://dribbble.com" },
      { key: "behance", url: "https://www.behance.net" },
      { key: "coolors", url: "https://coolors.co" },
      { key: "unsplash", url: "https://unsplash.com" },
      { key: "iconfont", url: "https://www.iconfont.cn" },
      { key: "lucide", url: "https://lucide.dev" },
      { key: "googlefonts", url: "https://fonts.google.com" },
    ],
  },
  {
    key: "ai",
    emoji: "🤖",
    links: [
      { key: "chatgpt", url: "https://chat.openai.com" },
      { key: "claude", url: "https://claude.ai" },
      { key: "huggingface", url: "https://huggingface.co" },
      { key: "copilot", url: "https://github.com/features/copilot" },
      { key: "midjourney", url: "https://www.midjourney.com" },
      { key: "stablediffusion", url: "https://stability.ai" },
    ],
  },
  {
    key: "community",
    emoji: "💬",
    links: [
      { key: "devto", url: "https://dev.to" },
      { key: "hn", url: "https://news.ycombinator.com" },
      { key: "v2ex", url: "https://www.v2ex.com" },
      { key: "juejin", url: "https://juejin.cn" },
      {
        key: "reddit",
        url: "https://www.reddit.com/r/programming/",
      },
      { key: "producthunt", url: "https://www.producthunt.com" },
    ],
  },
];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "links" });
  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function LinksPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("links");

  return (
    <>
      <h1 className="page-title">{t("heading")}</h1>
      <p className="page-subtitle">{t("subtitle")}</p>

      <div className="links-categories">
        {categories.map((cat) => (
          <section key={cat.key} className="links-category">
            <h2 className="links-category-title">
              <span className="links-emoji">{cat.emoji}</span>
              {t(`categories.${cat.key}.title`)}
            </h2>
            <div className="links-grid">
              {cat.links.map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  className="link-card"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="link-name">
                    {t(`categories.${cat.key}.links.${link.key}.name`)}
                  </span>
                  <span className="link-desc">
                    {t(`categories.${cat.key}.links.${link.key}.desc`)}
                  </span>
                  <span className="link-arrow" aria-hidden="true">
                    ↗
                  </span>
                </a>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
