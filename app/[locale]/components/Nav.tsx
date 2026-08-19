"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import LanguageSwitcher from "./LanguageSwitcher";
import ThemeToggle from "./ThemeToggle";

const navItems = [
  { href: "/", key: "home" },
  { href: "/about", key: "about" },
  { href: "/projects", key: "projects" },
  { href: "/blog", key: "blog" },
  { href: "/links", key: "links" },
  { href: "/tools", key: "tools" },
  { href: "/contact", key: "contact" },
] as const;

export default function Nav() {
  const t = useTranslations("nav");
  const currentPath = usePathname() ?? "/";

  return (
    <header className="nav">
      <div className="nav-container">
        <Link href="/" className="nav-logo">
          LuckyLab
        </Link>
        <div className="nav-right">
          <nav className="nav-links" aria-label={t("ariaLabel")}>
            {navItems.map((item) => {
              const isActive =
                item.href === "/"
                  ? currentPath === "/"
                  : currentPath.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-link${isActive ? " nav-link--active" : ""}`}
                  aria-current={isActive ? "page" : undefined}
                >
                  {t(item.key)}
                </Link>
              );
            })}
          </nav>
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
