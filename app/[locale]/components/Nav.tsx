"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import LanguageSwitcher from "./LanguageSwitcher";
import ThemeToggle from "./ThemeToggle";
import { ICONS, navItems } from "./nav/NavIcons";
import { useDockPress } from "./nav/useDockPress";
import { useDockMode } from "./nav/useDockMode";

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

  // Press-key physics: pointer events span the whole dock so the sweep
  // pre-presses neighbouring keys across brand / divider / tools areas
  useDockPress(dockRef, listRef, itemRefs);
  // Slab <-> capsule scroll state machine + reading-progress ink bar
  useDockMode(headerRef);

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
    <header className="dock-header" ref={headerRef} data-dock-mode="slab">
      <div className="dock" ref={dockRef}>
        <span className="dock-progress" aria-hidden="true" />
        <div className="dock-inner">
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
      </div>
    </header>
  );
}
