import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/**
 * Locale-aware navigation helpers.
 *
 * Use `Link`, `usePathname`, `useRouter` and `redirect` from here instead of
 * `next/link` / `next/navigation` so that links automatically stay within the
 * active locale (and the default locale omits its prefix).
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
