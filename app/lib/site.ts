// 站点对外 URL 的单一事实来源：sitemap / robots / RSS feed / metadataBase。
// 换域名时只需配置 NEXT_PUBLIC_SITE_URL（见 .env.example），无需改代码。
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.rdom.cn";
