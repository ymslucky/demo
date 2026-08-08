"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "./ThemeToggle";

const navItems = [
  { href: "/", label: "首页" },
  { href: "/about", label: "关于" },
  { href: "/projects", label: "项目" },
  { href: "/links", label: "导航" },
  { href: "/tools", label: "工具" },
  { href: "/contact", label: "联系" },
];

export default function Nav() {
  const currentPath = usePathname() ?? "/";

  return (
    <header className="nav">
      <div className="nav-container">
        <Link href="/" className="nav-logo">
          LuckyLab
        </Link>
        <div className="nav-right">
          <nav className="nav-links" aria-label="主导航">
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
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
