/**
 * 根路径语言协商（EdgeOne 边缘函数）— functions/index.js 映射到 `/`。
 *
 * 站点为纯静态导出（out/），所有页面都在 /zh/ 与 /en/ 前缀下
 * （i18n routing.ts: localePrefix "always"）。静态托管无法对 `/`
 * 做内容协商，因此由本函数拦截 `/`：
 * 1. 读取 next-intl 写入的 NEXT_LOCALE cookie（语言切换器维护）；
 * 2. 否则按 Accept-Language 权重解析；
 * 3. 都无法识别时回退默认 locale zh。
 * 结果以 302 跳转到对应 locale 的根页面，并禁止缓存（302 基于
 * 单个请求的 cookie/header，绝不能被 CDN 或浏览器缓存）。
 *
 * EdgeOne Pages 语义：没有匹配到函数路由的请求回落到静态资源，
 * 因此本文件只影响 `/`，不拖累其余静态路径。
 */

const DEFAULT_LOCALE = "zh";

/**
 * 解析 Accept-Language 头为按权重降序的语言标签数组。
 * 同权重时保持原顺序（Array#sort 在 V8 中是稳定排序）。
 * 导出仅供测试。
 */
export function parseAcceptLanguage(header) {
  return (header ?? "")
    .split(",")
    .map((part) => {
      const segments = part.trim().split(";");
      let q = 1;
      for (const segment of segments.slice(1)) {
        const [name, value] = segment.split("=");
        if (name?.trim() === "q") {
          const parsed = Number.parseFloat(value);
          if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) q = parsed;
        }
      }
      return { tag: (segments[0] ?? "").trim().toLowerCase(), q };
    })
    .filter((entry) => entry.tag.length > 0)
    .sort((a, b) => b.q - a.q)
    .map((entry) => entry.tag);
}

function localeFromCookie(cookieHeader) {
  const match = /(?:^|;\s*)NEXT_LOCALE=([^;]*)/.exec(cookieHeader ?? "");
  if (!match) return null;
  const value = decodeURIComponent(match[1]).trim().toLowerCase();
  if (value.startsWith("zh")) return "zh";
  if (value.startsWith("en")) return "en";
  return null;
}

/**
 * 语言决策：cookie > Accept-Language 权重顺序 > 默认 zh。
 * 导出仅供测试。
 */
export function pickLocale(cookieHeader, acceptLanguage) {
  const fromCookie = localeFromCookie(cookieHeader);
  if (fromCookie) return fromCookie;
  for (const tag of parseAcceptLanguage(acceptLanguage)) {
    if (tag.startsWith("zh")) return "zh";
    if (tag.startsWith("en")) return "en";
  }
  return DEFAULT_LOCALE;
}

export async function onRequest({ request }) {
  const target = pickLocale(
    request.headers.get("cookie"),
    request.headers.get("accept-language")
  );
  return new Response(null, {
    status: 302,
    headers: {
      location: new URL(`/${target}/`, request.url).toString(),
      "cache-control": "no-store",
    },
  });
}
