"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import LanguageSwitcher from "./LanguageSwitcher";
import ThemeToggle from "./ThemeToggle";
import { ICONS, navItems } from "./nav/NavIcons";
import { useDockMagnification } from "./nav/useDockMagnification";
import { useImmersiveHeader } from "./nav/useImmersiveHeader";

export default function Nav() {
  const t = useTranslations("nav");
  const currentPath = usePathname() ?? "/";
  const headerRef = useRef<HTMLElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([]);

  const activeIndex = navItems.findIndex((item) =>
    item.href === "/" ? currentPath === "/" : currentPath.startsWith(item.href)
  );

  // Dock magnification loop — pointer events span the whole dock so the
  // magnetic pull survives crossing the brand / divider / tools areas
  useDockMagnification(dockRef, listRef, itemRefs);
  useImmersiveHeader(headerRef);

  // Auto-center the active item inside the mobile scroll rail
  useEffect(() => {
    const el = itemRefs.current[activeIndex];
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({
      inline: "center",
      block: "nearest",
      behavior: reduce ? "auto" : "smooth",
    });
  }, [activeIndex]);

  return (
    <header className="dock-header" ref={headerRef}>
      <div className="dock" ref={dockRef}>
        <Link href="/" className="dock-brand">
          <span className="dock-brand-mark" aria-hidden="true">
            L
          </span>
          <span className="dock-brand-text">LuckyLab</span>
        </Link>
        <div className="dock-items" ref={listRef}>
          <nav className="dock-nav" aria-label={t("ariaLabel")}>
            {navItems.map((item, i) => {
              const isActive = i === activeIndex;
              return (
                <Link
                  key={item.href}
                  ref={(el) => {
                    itemRefs.current[i] = el;
                  }}
                  href={item.href}
                  className="dock-item"
                  data-active={isActive ? "true" : undefined}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={t(item.key)}
                >
                  {ICONS[item.key]}
                  <span className="dock-item-label" aria-hidden="true">
                    {t(item.key)}
                  </span>
                </Link>
              );
            })}
          </nav>
        </div>
        <span className="dock-divider" aria-hidden="true" />
        <div className="dock-tools">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
