export const navItems = [
  { href: "/", key: "home" },
  { href: "/about", key: "about" },
  { href: "/projects", key: "projects" },
  { href: "/blog", key: "blog" },
  { href: "/links", key: "links" },
  { href: "/tools", key: "tools" },
  { href: "/contact", key: "contact" },
] as const;

export type NavKey = (typeof navItems)[number]["key"];
