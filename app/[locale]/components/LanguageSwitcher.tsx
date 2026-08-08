"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";

/**
 * Language switcher — toggles between Chinese (default, unprefixed) and
 * English (/en). Uses client-side navigation, so switching locales does not
 * trigger a full page reload.
 */
export default function LanguageSwitcher() {
  const t = useTranslations("languageSwitcher");
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();

  const switchTo = (next: Locale) => {
    if (next === locale) return;
    router.replace(pathname, { locale: next });
  };

  return (
    <div className="lang-switch" role="group" aria-label={t("label")}>
      {routing.locales.map((loc) => {
        const active = loc === locale;
        const label = loc === "zh" ? t("zhLabel") : t("enLabel");
        const title = loc === "zh" ? t("switchToZh") : t("switchToEn");
        return (
          <button
            key={loc}
            type="button"
            className={`lang-switch-btn${active ? " lang-switch-btn--active" : ""}`}
            aria-pressed={active}
            title={title}
            onClick={() => switchTo(loc)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
