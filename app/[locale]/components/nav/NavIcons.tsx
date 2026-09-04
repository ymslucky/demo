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

export const ICONS: Record<NavKey, React.ReactNode> = {
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
