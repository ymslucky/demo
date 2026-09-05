"use client";

import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import {
  SYSTEM_DARK_QUERY,
  applyTheme,
  getSavedTheme,
  nextTheme,
  persistTheme,
  readCurrentTheme,
  shouldFollowSystem,
  type Theme,
} from "../../lib/theme";

/**
 * 订阅主题变化：当 `data-theme` 属性被修改（点击切换按钮）时，
 * 或系统偏好发生变化时（仅当用户尚未手动覆盖主题的情况下），
 * 触发重渲染。
 */
function subscribeTheme(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  const mq = window.matchMedia(SYSTEM_DARK_QUERY);
  const onSystemChange = (e: MediaQueryListEvent) => {
    // 用户手动选择过主题后，忽略系统变化。
    if (!shouldFollowSystem(getSavedTheme())) return;
    applyTheme(e.matches ? "dark" : "light");
    onChange();
  };
  mq.addEventListener("change", onSystemChange);

  return () => {
    observer.disconnect();
    mq.removeEventListener("change", onSystemChange);
  };
}

function getThemeSnapshot(): Theme {
  return readCurrentTheme();
}

/** SSR 阶段：属性尚不存在时按 light 渲染，以避免 hydration 不匹配。 */
function getThemeServerSnapshot(): Theme {
  return "light";
}

export default function ThemeToggle() {
  const t = useTranslations("theme");
  // 主题来自真实的 DOM 状态（由 pre-paint 内联脚本设置）；点击后由
  // MutationObserver 驱动重渲染 —— 不保存本地副本。
  const theme = useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getThemeServerSnapshot,
  );
  const label = theme === "dark" ? t("toggleToLight") : t("toggleToDark");

  const toggle = () => {
    const next = nextTheme(readCurrentTheme());
    applyTheme(next);
    persistTheme(next);
  };

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={label}
      title={label}
    >
      {/* Sun icon (visible in light mode) */}
      <svg
        className="theme-toggle__icon theme-toggle__icon--sun"
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
      {/* 月亮图标（深色模式下可见） */}
      <svg
        className="theme-toggle__icon theme-toggle__icon--moon"
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    </button>
  );
}
