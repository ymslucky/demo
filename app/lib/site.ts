// 站点对外 URL 的单一事实来源：sitemap / robots / RSS feed / metadataBase。
// 由 SITE_DOMAIN 派生为 https://www.<域名>（全站唯一域名变量，见 .env.example），
// 未配置默认 rdom.cn。
const SITE_APEX =
  (process.env.SITE_DOMAIN ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .replace(/^www\./, "") || "rdom.cn";

export const SITE_URL = `https://www.${SITE_APEX}`;
