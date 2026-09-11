import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing } from "./routing";
import zh from "../messages/zh";
import en from "../messages/en";

/**
 * Loads the message catalog for the active locale.
 *
 * 词表按域模块化：messages/{locale}/{group}.json（每个文件一组顶层命名
 * 空间，如 core = metadata/nav/footer/…），由 messages/{locale}/index.ts
 * 聚合成与拆分前一致的单一对象；zh/en 键结构同构由 tests/i18n.test.ts
 * 强制。新增命名空间文件时在对应 index.ts 中登记即可。
 */
const catalogs = { zh, en } as const;

export default getRequestConfig(async ({ requestLocale }) => {
  // Typically corresponds to the `[locale]` segment.
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: catalogs[locale],

    /**
     * Missing-key policy (acceptance: fail visibly in dev, never crash prod).
     *
     * In development a missing message throws so the problem surfaces
     * immediately; in production it is logged and the rendered fallback (the
     * key path, via `getMessageFallback`) keeps the UI functional.
     */
    onError(error) {
      if (process.env.NODE_ENV === "production") {
        console.error(error);
      } else {
        throw error;
      }
    },

    /**
     * Fallback text rendered when a message is missing. Showing the key path
     * makes missing keys visible in the UI instead of silently blank text.
     */
    getMessageFallback({ namespace, key }) {
      return [namespace, key].filter(Boolean).join(".");
    },
  };
});
