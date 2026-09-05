/**
 * 主题管理 — 纯逻辑 + 轻量 DOM 辅助函数。
 *
 * 抽取出来是为了让决策逻辑（存储的偏好 vs 系统偏好）可以
 * 在隔离环境中做单元测试（node 环境），与 app/tools/utils 的
 * 模式保持一致。所有 DOM 访问都是防御式的（SSR 安全）。
 *
 * 主题契约（来自 globals.css 中的 CSS）：
 * - <html> 无 data-theme 属性            -> 跟随系统 prefers-color-scheme
 * - <html data-theme="light">            -> 强制 light
 * - <html data-theme="dark">             -> 强制 dark
 *
 * localStorage 键 "theme" 保存手动覆盖值（"light" | "dark"）。
 * 键不存在即表示"跟随系统"。
 */

export const THEME_STORAGE_KEY = "theme";

export const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

export type Theme = "light" | "dark";

export const THEMES: readonly Theme[] = ["light", "dark"];

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

/**
 * 从存储的偏好（用户从未手动选择时为 null）与系统偏好中解析出
 * 实际生效的主题。有效的手动选择始终优先；否则跟随系统。
 */
export function resolveTheme(stored: string | null, systemPrefersDark: boolean): Theme {
  if (isTheme(stored)) return stored;
  return systemPrefersDark ? "dark" : "light";
}

/** 相对主题（用于切换按钮）。 */
export function nextTheme(current: Theme): Theme {
  return current === "dark" ? "light" : "dark";
}

/** 用户尚未手动覆盖时为 true（即应跟随系统）。 */
export function shouldFollowSystem(stored: string | null): boolean {
  return !isTheme(stored);
}

/** 安全的 localStorage 读取；不可用或非有效主题时返回 null。 */
export function getSavedTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** 安全地写入 localStorage 手动覆盖值。 */
export function persistTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // storage 不可用（隐私模式、SSR）— 主题仍对本页生效
  }
}

/** 清除手动覆盖，让站点重新跟随系统。 */
export function clearSavedTheme(): void {
  try {
    localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    // 忽略
  }
}

/** 当前系统对 dark 的偏好。SSR 安全（返回 false）。 */
export function systemPrefersDark(): boolean {
  try {
    return typeof window !== "undefined" && window.matchMedia(SYSTEM_DARK_QUERY).matches;
  } catch {
    return false;
  }
}

/** 当前实际生效的主题，先读 DOM 属性，再读系统偏好。 */
export function readCurrentTheme(): Theme {
  try {
    const attr = document.documentElement.getAttribute("data-theme");
    if (isTheme(attr)) return attr;
  } catch {
    // document 不可用（SSR）
  }
  return systemPrefersDark() ? "dark" : "light";
}

/** 将主题应用到文档根节点。 */
export function applyTheme(theme: Theme): void {
  try {
    document.documentElement.setAttribute("data-theme", theme);
  } catch {
    // SSR — 无可应用对象
  }
}

/**
 * 内联于 <head>/body 早期的脚本，在首次绘制之前应用主题，
 * 防止错误主题闪烁（FOUC）。自包含 ES5，无 import。
 * 与 resolveTheme 决策逻辑相同：手动覆盖优先，否则跟随系统。
 */
export function themeInitScript(): string {
  return [
    "(function () {",
    "  try {",
    "    var stored = null;",
    "    try { stored = localStorage.getItem(\"" + THEME_STORAGE_KEY + "\"); } catch (e) {}",
    "    var dark = false;",
    "    try { dark = window.matchMedia && window.matchMedia(\"(prefers-color-scheme: dark)\").matches; } catch (e) {}",
    "    var theme = (stored === \"light\" || stored === \"dark\") ? stored : (dark ? \"dark\" : \"light\");",
    "    document.documentElement.setAttribute(\"data-theme\", theme);",
    "  } catch (e) {}",
    "})();",
  ].join("\n");
}
