import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { THEME_STORAGE_KEY } from "../app/lib/theme";
import { stripComments } from "./strip-comments";

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

// app/ 下全部 .ts/.tsx 文件清单（相对 app/ 的路径，POSIX 分隔符），
// 用于全量扫描非法 <script> 渲染点。
function collectFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return collectFiles(full);
    return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")
      ? [relative(APP, full).split("\\").join("/")]
      : [];
  });
}
const COMPONENT_FILES = collectFiles(APP);

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
    // No CJK in code content — comments are stripped first since they may
    // legitimately be written in Chinese; strings and JSX text may not.
    expect(/[\u4e00-\u9fff]/.test(stripComments(src, "ThemeToggle.tsx"))).toBe(false);
  });

  it("theme lib source contains no user-facing hardcoded strings", () => {
    const src = read("lib/theme.ts");
    expect(/[\u4e00-\u9fff]/.test(stripComments(src, "theme.ts"))).toBe(false);
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

  it("layout renders the theme init script inline in <head> (SSR mode)", () => {
    // SSR 架构（无 out/ 静态目录、无构建后注入管线）：主题脚本由根 layout
    // 以 server component 身份直出进 <head>，遵循 Next.js 官方
    // preventing-flash-before-hydration 指南的 Themes 章节。
    const layout = read("[locale]/layout.tsx");
    // 脚本字符串的唯一来源是 app/lib/theme.ts 的 themeInitScript()
    expect(layout).toMatch(/import \{ themeInitScript \} from "\.\.\/lib\/theme"/);
    // 必须以 dangerouslySetInnerHTML 内联渲染（HTML 解析阶段同步执行）
    expect(layout).toMatch(/dangerouslySetInnerHTML=\{\{ __html: themeInitScript\(\) \}\}/);
    // 渲染点必须在 <head> 内（先于任何内容绘制执行）
    expect(layout).toMatch(/<head>[\s\S]*themeInitScript\(\)[\s\S]*<\/head>/);
    // 脚本不得再走构建后注入管线（注入器已随静态导出一起退役）
    expect(() => statSync(join(process.cwd(), "scripts", "inject-theme.mjs"))).toThrow();
  });

  it("layout is the ONLY component rendering a <script> node", () => {
    // 反 FOUC 脚本必须且只能由 server-rendered 的根 layout 提供；
    // 其它任何组件（尤其 client components）渲染 script 节点都会
    // 触发 React 19 的客户端告警或破坏单一来源契约。
    const offenders = COMPONENT_FILES.filter((rel) => {
      if (rel === "[locale]/layout.tsx") return false;
      return /<script/.test(stripComments(read(rel), rel));
    });
    expect(offenders).toEqual([]);
  });
});
