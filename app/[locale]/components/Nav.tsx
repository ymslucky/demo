"use client";

import { useEffect, useRef } from "react";
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

type NavKey = (typeof navItems)[number]["key"];

const ICONS: Record<NavKey, React.ReactNode> = {
  home: (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 11 12 3l9 8" />
      <path d="M5 10v11h14V10" />
    </svg>
  ),
  about: (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" />
    </svg>
  ),
  projects: (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  ),
  blog: (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  ),
  links: (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M10 13a5 5 0 0 0 7.5.5l2.5-2.5a5 5 0 0 0-7-7l-1.5 1.5" />
      <path d="M14 11a5 5 0 0 0-7.5-.5L4 13a5 5 0 0 0 7 7l1.5-1.5" />
    </svg>
  ),
  tools: (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z" />
    </svg>
  ),
  contact: (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-10 6L2 7" />
    </svg>
  ),
};

/* ThreeUI "Animated Top Dock" motion (sable dock):
   gaussian proximity magnification + under-damped spring, applied by
   mutating element styles directly to avoid React re-renders */
const SPRING = 0.19; // spring stiffness
const DAMPING = 0.7; // damping ratio
const SIGMA = 60; // gaussian influence radius (px)
const MAX_GROW = 0.2; // max magnification (+20%)
const MAX_LIFT = -6; // max lift (px); extra shadow drop is computed in CSS via --dock-lift

export default function Nav() {
  const t = useTranslations("nav");
  const currentPath = usePathname() ?? "/";
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const springs = useRef(navItems.map(() => ({ s: 0, v: 0 })));

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    // Fine pointers only; respect the user's reduced-motion preference
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let running = false;
    let pointerX: number | null = null;
    let centers: number[] = [];

    // offsetLeft/offsetWidth ignore transforms, so they are stable base positions
    const measure = () => {
      centers = itemRefs.current.map((el) =>
        el ? el.offsetLeft + el.offsetWidth / 2 : 0
      );
    };

    const wake = () => {
      if (!running) {
        running = true;
        raf = requestAnimationFrame(tick);
      }
    };

    const tick = () => {
      let active = false;
      itemRefs.current.forEach((el, i) => {
        if (!el) return;
        let target = 0;
        if (pointerX !== null) {
          const d = pointerX - centers[i];
          target = Math.exp(-(d * d) / (2 * SIGMA * SIGMA));
        }
        const sp = springs.current[i];
        sp.v = (sp.v + (target - sp.s) * SPRING) * DAMPING;
        sp.s += sp.v;
        if (target === 0 && Math.abs(sp.s) < 0.002 && Math.abs(sp.v) < 0.002) {
          sp.s = 0;
          sp.v = 0;
        } else {
          active = true;
        }
        const s = sp.s;
        el.style.transform = `translateY(${(MAX_LIFT * s).toFixed(2)}px) scale(${(1 + MAX_GROW * s).toFixed(4)})`;
        el.style.setProperty("--dock-lift", s.toFixed(3));
        el.style.zIndex = s > 0.02 ? String(10 + Math.round(s * 10)) : "";
      });
      if (active || pointerX !== null) {
        raf = requestAnimationFrame(tick);
      } else {
        running = false;
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      pointerX = e.clientX - list.getBoundingClientRect().left;
      wake();
    };
    const onPointerEnter = () => {
      measure();
      wake();
    };
    const onPointerLeave = () => {
      pointerX = null;
      wake();
    };
    // Keyboard focus magnifies the focused item (same spring channel as pointer)
    const onFocusIn = (e: FocusEvent) => {
      const idx = itemRefs.current.indexOf(e.target as HTMLAnchorElement);
      if (idx >= 0) {
        measure();
        pointerX = centers[idx];
        wake();
      }
    };
    const onFocusOut = (e: FocusEvent) => {
      if (!list.contains(e.relatedTarget as Node)) {
        pointerX = null;
        wake();
      }
    };

    list.addEventListener("pointermove", onPointerMove);
    list.addEventListener("pointerenter", onPointerEnter);
    list.addEventListener("pointerleave", onPointerLeave);
    list.addEventListener("focusin", onFocusIn);
    list.addEventListener("focusout", onFocusOut);

    return () => {
      cancelAnimationFrame(raf);
      running = false;
      list.removeEventListener("pointermove", onPointerMove);
      list.removeEventListener("pointerenter", onPointerEnter);
      list.removeEventListener("pointerleave", onPointerLeave);
      list.removeEventListener("focusin", onFocusIn);
      list.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  return (
    <header className="dock-header">
      <div className="dock">
        <Link href="/" className="dock-brand">
          <span className="dock-brand-mark" aria-hidden="true">
            L
          </span>
          <span className="dock-brand-text">LuckyLab</span>
        </Link>
        <div className="dock-items" ref={listRef}>
          <nav className="dock-nav" aria-label={t("ariaLabel")}>
            {navItems.map((item, i) => {
              const isActive =
                item.href === "/"
                  ? currentPath === "/"
                  : currentPath.startsWith(item.href);
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
