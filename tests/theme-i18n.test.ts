import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { THEME_STORAGE_KEY } from "../app/lib/theme";

/**
 * Cross-feature contract: i18n (zh/en) × theme (light/dark).
 *
 * These tests pin the integration points between the two feature areas:
 * 1. The theme toggle's user-facing labels are real, translated i18n keys
 *    present in BOTH catalogs (not hardcoded strings).
 * 2. The theme toggle component is wired through next-intl and never falls
 *    back to hardcoded UI text.
 * 3. Theme persistence (localStorage "theme") is fully independent of
 *    language persistence (next-intl cookie) — the two preferences never
 *    share a storage key, so toggling one can never clobber the other.
 */

const APP = join(process.cwd(), "app");
const read = (rel: string) => readFileSync(join(APP, rel), "utf8");

function loadCatalog(locale: "zh" | "en"): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(process.cwd(), "messages", `${locale}.json`), "utf8"),
  );
}

function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object" && v !== null
      ? flatten(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

describe("theme × i18n integration", () => {
  const zh = loadCatalog("zh");
  const en = loadCatalog("en");
  const zhKeys = new Set(flatten(zh));
  const enKeys = new Set(flatten(en));

  it("theme namespace exists in both catalogs with both toggle labels", () => {
    for (const key of ["theme.toggleToDark", "theme.toggleToLight"]) {
      expect(zhKeys.has(key), `zh missing ${key}`).toBe(true);
      expect(enKeys.has(key), `en missing ${key}`).toBe(true);
    }
  });

  it("theme labels are genuinely translated (en ≠ zh) and non-empty", () => {
    const zhT = (zh as { theme: Record<string, string> }).theme;
    const enT = (en as { theme: Record<string, string> }).theme;
    for (const key of ["toggleToDark", "toggleToLight"]) {
      expect(zhT[key].trim().length).toBeGreaterThan(0);
      expect(enT[key].trim().length).toBeGreaterThan(0);
      expect(enT[key]).not.toBe(zhT[key]);
      // English label must not contain CJK characters
      expect(/[\u4e00-\u9fff]/.test(enT[key])).toBe(false);
    }
  });

  it("ThemeToggle resolves its labels through useTranslations('theme')", () => {
    const src = read("[locale]/components/ThemeToggle.tsx");
    expect(src).toMatch(/useTranslations\("theme"\)/);
    // Both keys referenced dynamically via t(), no hardcoded label strings
    expect(src).toMatch(/t\("toggleToDark"\)/);
    expect(src).toMatch(/t\("toggleToLight"\)/);
    // No CJK anywhere in the component source (i18n source-clean rule)
    expect(/[\u4e00-\u9fff]/.test(src)).toBe(false);
  });

  it("theme lib source contains no user-facing hardcoded strings", () => {
    const src = read("lib/theme.ts");
    expect(/[\u4e00-\u9fff]/.test(src)).toBe(false);
  });

  it("theme persistence key is independent of locale persistence", () => {
    // Theme uses localStorage key "theme"...
    expect(THEME_STORAGE_KEY).toBe("theme");
    const themeLib = read("lib/theme.ts");
    expect(themeLib).toMatch(/localStorage\.getItem\(THEME_STORAGE_KEY\)/);
    expect(themeLib).toMatch(/localStorage\.setItem\(THEME_STORAGE_KEY/);

    // ...and the language switcher must not touch localStorage("theme")
    const switcher = read("[locale]/components/LanguageSwitcher.tsx");
    expect(switcher).not.toMatch(/localStorage/);
    expect(switcher).not.toContain(THEME_STORAGE_KEY);
    // next-intl persists the locale via routing/cookie, not the theme key
    const request = readFileSync(
      join(process.cwd(), "i18n", "request.ts"),
      "utf8",
    );
    expect(request).not.toContain("localStorage");
  });

  it("Nav renders both the language switcher and the theme toggle", () => {
    const nav = read("[locale]/components/Nav.tsx");
    expect(nav).toContain("<LanguageSwitcher />");
    expect(nav).toContain("<ThemeToggle />");
  });

  it("locale layout injects the pre-paint theme init script", () => {
    const layout = read("[locale]/layout.tsx");
    expect(layout).toContain("themeInitScript()");
    expect(layout).toContain("suppressHydrationWarning");
    // Script must be inside <body> so data-theme applies before first paint
    const jsxUsage = layout.indexOf(
      'dangerouslySetInnerHTML={{ __html: themeInitScript() }}',
    );
    expect(jsxUsage).toBeGreaterThan(-1);
    expect(jsxUsage).toBeGreaterThan(layout.indexOf("<body>"));
  });
});
