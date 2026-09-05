"use client";

import { useLocale } from "next-intl";
import { useLayoutEffect } from "react";
import {
  applyTheme,
  getSavedTheme,
  resolveTheme,
  systemPrefersDark,
} from "../../lib/theme";

/**
 * 在客户端导航之间保持 `html[data-theme]` 同步。
 *
 * layout 中的 pre-paint 内联脚本会在整页加载时设置一次 `data-theme`。
 * 而在客户端切换语言（语言切换按钮）时，React 会重新协调 <html> 元素
 * 并移除那个以命令式方式设置的属性，用户已保存的主题会被静默回落
 * 到系统默认值。
 *
 * 本组件在 locale 变化时会于 layout effect 中同步地重新应用已保存
 * （或系统）的主题 —— 赶在浏览器绘制之前完成 ——
 * 因此不会闪现错误的主题，保存的偏好始终胜出。
 */
export default function ThemeSync() {
  const locale = useLocale();

  useLayoutEffect(() => {
    applyTheme(resolveTheme(getSavedTheme(), systemPrefersDark()));
  }, [locale]);

  return null;
}
