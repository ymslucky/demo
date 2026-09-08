---
name: "neo-brutalism-ui"
description: "本仓库的 UI 约定：Neo-Brutalism CSS token（实心位移阴影、禁模糊）、流式容器/断点、零运行时动效与图标、Morphing Slab 导航不变量、防 FOUC 主题脚本的 SSR 契约。凡涉及 CSS、主题、Nav/dock 或 layout 时调用。"
---

# Neo-Brutalism UI、动效与主题

## 1. 视觉语言

硬朗 3px 边框、实心位移 `box-shadow`（2–4px 位移量）、`#ea580c` 橙色强调色、
正文 Inter、`<code>` 类标签回退 JetBrains Mono。

## 2. CSS token 与布局不变量

- 所有表面统一使用 [app/globals.css](../../app/globals.css) /
  [app/styles/tokens.css](../../app/styles/tokens.css) 中的单一变量家族：
  `--color-border`、`--color-surface`、`--shadow-sm/lg/primary`、`--radius-sm/md/lg`。
- **UI 元素禁止模糊 `box-shadow`**。深度永远是实心的、带位移的边框色像素块
  （`2px 2px 0 0 var(--color-border)` 及其变体）。要抬升元素就加大**位移量**，
  绝不加模糊。
- 容器为流式、clamp() 缩放内边距——`.container` / `.footer-container` 使用
  `padding-inline: clamp(var(--space-md), 4vw, var(--space-2xl))`；`.container`
  另有居中上限 `max-width: 100rem; margin-inline: auto`，保证 2K/4K 超宽屏仍有
  充足边距——**不要缩小该上限**。
- 断点：`880px`（品牌收拢为单字母标）与 `640px`（dock 变为可滚动横轨）。
  新增导航元素时必须尊重这两个断点。
- **不要**重新引入 Tailwind——项目有意保持 0 CSS-in-JS / 工具类运行时。

## 3. 零运行时动效与图标

禁止 framer-motion / lucide-react 之类运行时依赖。动画全部手写 CSS keyframes；
图标全部内联 SVG（24 网格、`stroke="currentColor"`、`aria-hidden`）。包体积是
设计约束：改客户端组件时检查 `npm run build` 的 chunk 表。

## 4. Morphing Slab 导航不变量

源文件：[Nav.tsx](../../app/[locale]/components/Nav.tsx)、
[useDockMode.ts](../../app/[locale]/components/nav/useDockMode.ts)、
[useDockPress.ts](../../app/[locale]/components/nav/useDockPress.ts)。

- 头部在**任何滚动位置都是恒定的全宽板材**——绝不会变形为悬浮胶囊。滚动超过
  24px 只是收紧它并填充进度线（`header[data-scrolled]`）。
- 按压物理：每个指针帧的样式变更都在单个 `rAF` 循环内完成（每帧零 React
  渲染），并喂给一条与键盘焦点共享的欠阻尼弹簧。
- `prefers-reduced-motion` 与非精细指针完全禁用动效。
- 调参常量就在源码里——把它们当作已成文的"手感"，不是自由参数。

## 5. 防 FOUC 主题脚本 —— SSR 契约

1. **单一事实来源**：[app/lib/theme.ts](../../app/lib/theme.ts) 中的
   `themeInitScript()`（自包含 ES5 字符串，无 import）。
2. **由根布局在 `<head>` 中服务端内联渲染**
   （[app/[locale]/layout.tsx](../../app/[locale]/layout.tsx)），方式为
   `<script dangerouslySetInnerHTML>`——在 HTML 解析期间、首次绘制之前同步执行，
   且从不进入客户端 React 树。
   - **不要**换成 `next/script`（`strategy="beforeInteractive"` 仍会创建客户端
     VDOM script 节点，在客户端导航时触发 React 19 警告）。
   - **不要**用 `<template>`（惰性内容不会自动执行）。
3. **根布局是 `app/` 里唯一的 `<script>` 渲染者**——由
   [tests/theme-i18n.test.ts](../../tests/theme-i18n.test.ts) 强制；已退役的
   构建时注入器（[scripts/inject-theme.mjs](../../scripts/inject-theme.mjs)）
   若重现该测试同样失败。
4. `<html>` 上的 `suppressHydrationWarning` 仅用于吞掉水合前脚本造成的
   `data-theme` 属性不匹配；与 script 元素本身无关。
