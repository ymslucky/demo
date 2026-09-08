"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { SignInButton, SignUpButton, Show, UserButton } from "@clerk/nextjs";
import { Link, usePathname } from "@/i18n/navigation";
import LanguageSwitcher from "./LanguageSwitcher";
import ThemeToggle from "./ThemeToggle";
import { ICONS } from "./nav/icons";
import { navItems } from "./nav/navItems";
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

  // 按键物理效果：pointer 事件绑定在整个 dock 上，指针扫过时
  // brand / divider / tools 区域两侧相邻的按键也会被预按下
  useDockPress(dockRef, listRef, itemRefs);
  // 常驻平板（constant-slab）滚动状态（data-scrolled 收紧 + 进度墨条）
  useDockMode(headerRef);

  // 在移动端滚动轨道内自动居中当前激活项
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
        <span className="dock-progress" aria-hidden="true" />
        <div className="dock-inner">
          {/* prefetch={false}：本站每个路由都是很小的静态页面；
              每次页面加载都预取全部路由，会用用户很少点击的链接产生的
              后台 RSC 请求刷屏网络日志。 */}
          <Link href="/" className="dock-brand" prefetch={false}>
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
                    prefetch={false}
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
            {/* Auth controls: sign-in / sign-up while signed out, avatar
                menu while signed in. Labels go through next-intl. */}
            <Show when="signed-out">
              <SignInButton mode="modal">
                <button type="button" className="dock-auth-btn">
                  {t("signIn")}
                </button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button type="button" className="dock-auth-btn dock-auth-btn--primary">
                  {t("signUp")}
                </button>
              </SignUpButton>
            </Show>
            <Show when="signed-in">
              <span className="dock-user">
                <UserButton />
              </span>
            </Show>
          </div>
        </div>
      </div>
    </header>
  );
}
