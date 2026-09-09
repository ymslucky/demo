---
name: "i18n-locale-routing"
description: "本仓库的 next-intl 区域路由知识：localePrefix as-needed（中文无前缀）+ 尾斜杠、proxy.ts 内 cookie/Accept-Language 协商、app/route.ts 裸根兜底、app/ 目录 CJK-free 规则。凡涉及路由、locale、链接、messages 或新增页面时调用。"
---

# i18n 与区域路由

## 1. URL 契约

[i18n/routing.ts](../../i18n/routing.ts) 使用 `localePrefix: "as-needed"`——默认
locale（中文）的 URL **不带前缀**（`rdom.cn/…`），英文保留前缀（`rdom.cn/en/…`），
**一律带尾斜杠**。默认 locale 的带前缀 URL（`/zh/…`）会被 `intlMiddleware`
规范化重定向回无前缀路径，内部链接不要生成 `/zh/…` 形式；需要区域感知 href
时用 [i18n/navigation.ts](../../i18n/navigation.ts) 的链接原语（自动跟随前缀
模式）。

## 2. 区域协商（无前缀路径）

[proxy.ts](../../proxy.ts) 内的 `intlMiddleware` 按此确切顺序协商：

1. `NEXT_LOCALE` cookie →
2. `Accept-Language` 权重 →
3. 默认 `zh`

并以**重定向**应答（永不缓存）：协商得 `zh` 时留在无前缀路径，`en` 时
307 到 `/en/…`。

## 3. 裸根路径例外（`/`）

在 EdgeOne Pages 上，适配器的静态层**先于** Next.js 服务器处理 `/`（无静态
文件 → 404），所以 `proxy.ts` 在那里根本不运行。
[app/route.ts](../../app/route.ts) 是动态兜底处理器，在服务端执行同样的协商
（`NEXT_LOCALE` cookie → `Accept-Language` 权重 → 默认 `zh`）：协商得 `zh`
时 **rewrite 到 `/zh/` 树**（地址栏保持在 `/`；若 redirect 到 `/zh/` 会与
intlMiddleware 的 `/zh/`→`/` 规范化互相弹跳死循环）；协商得 `en` 时 307
重定向到 `/en/`。

**两条路径保持同步**——改动区域协商时必须一起改。

## 4. `app/**` 的 CJK-free 规则

- `app/**/*.ts(x)` 代码——字符串字面量、JSX 文本节点与标识符——必须不含中日韩
  字符。注释（`//`、`/* */`、JSDoc）中**允许**中文，便于阅读。
- 执行范围：[tests/i18n.test.ts](../../tests/i18n.test.ts) 只扫描 `app/`，并豁免
  `app/[locale]/blog/**`（独立文章内容，不是 i18n UI 文案）。`app/` 之外无此
  限制（`messages/*.json`、`app/styles/*.css`、`functions/`、E2E 脚本）。
- 机制：扫描前先用 `ts.transpileModule({ removeComments: true })` 剥掉注释
  （JSX 保留），所以只检查真正的代码内容。

## 5. 用户可见文案与 ARIA 标签

一律走 next-intl（`useTranslations`、`getTranslations`），词表在
[messages/zh.json](../../messages/zh.json) /
[messages/en.json](../../messages/en.json)。TSX 中硬编码含人类语言词的
`aria-label="…"` 会让测试失败。例外：机器专用属性
（`aria-current="page"`、`data-*`、CSS 类名）。

链接原语与请求配置在
[i18n/navigation.ts](../../i18n/navigation.ts) /
[i18n/request.ts](../../i18n/request.ts)——需要区域感知的 href 时用它们，
不要用裸 `<a>`/`Link`。
