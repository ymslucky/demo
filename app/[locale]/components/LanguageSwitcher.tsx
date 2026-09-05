"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { useTransition } from "react";

/** Static per-locale message keys — typed lookups, no ternary chains. */
const LOCALE_META: Record<Locale, { labelKey: string; titleKey: string }> = {
  zh: { labelKey: "zhLabel", titleKey: "switchToZh" },
  en: { labelKey: "enLabel", titleKey: "switchToEn" },
};

/**
 * 语言切换 —— dock 上的单个按钮，显示你将切换到的目标语言
 * （target-locale 模式）：中文页面显示英文标签，英文页面显示
 * 中文标签。点击会在 routing.locales 中循环切换；导航在
 * transition 内执行，因此在新的语言渲染完成之前，按钮会
 * 一直保持禁用状态。
 */
export default function LanguageSwitcher() {
  const t = useTranslations("languageSwitcher");
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const next =
    routing.locales[
      (routing.locales.indexOf(locale) + 1) % routing.locales.length
    ];
  const meta = LOCALE_META[next];

  const toggle = () => {
    startTransition(() => {
      router.replace(pathname, { locale: next });
    });
  };

  return (
    <button
      type="button"
      className="lang-toggle"
      aria-label={t(meta.titleKey)}
      title={t(meta.titleKey)}
      disabled={isPending}
      onClick={toggle}
    >
      {t(meta.labelKey)}
    </button>
  );
}
