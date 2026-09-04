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
 * Language toggle — a single dock button showing the locale you would switch
 * TO (target-locale pattern): the English label on Chinese pages, the Chinese
 * label on English pages. Clicking cycles through routing.locales; the
 * navigation runs inside a transition so the button stays disabled until the
 * new locale has rendered.
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
