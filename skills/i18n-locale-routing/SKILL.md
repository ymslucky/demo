---
name: "i18n-locale-routing"
description: "本仓库的 next-intl 区域路由知识：localePrefix as-needed（zh 裸路径、en 带前缀）+ 尾斜杠、EdgeOne 不支持 Next 层 rewrite（靠 edgeone.json 边缘 rewrites 兜底）、proxy.ts 内 cookie/Accept-Language 协商、app/ 目录 CJK-free 规则。凡涉及路由、locale、链接、messages 或新增页面时调用。"
---

# i18n 与区域路由

> **铁则**：`app/**/*.ts(x)` 代码 CJK-free（注释除外）；用户可见文案与 ARIA 标签一律经 next-intl 从 `messages/*.json` 取；新增顶级页面必须同步在 edgeone.json 补 rewrite。

## 1. URL 契约

[i18n/routing.ts](../../i18n/routing.ts) 使用 `localePrefix: "as-needed"`——默认
语言 zh 走**裸路径**（`/`、`/tools/`、`/blog/…`），en 保留前缀（`/en/…`），全部
**带尾斜杠**。站内链接（next-intl `Link`）、canonical、sitemap、feed 均按此生成。

## 2. 无前缀路径的改写（双通道）

as-needed 依赖"把裸路径内部改写到 `/zh/…`"。**EdgeOne 适配器不支持 Next 层
rewrite**（实证 2026-09）：

- Route Handler 中 `NextResponse.rewrite()` → **500**（`app route handler`
  显式报错）；
- proxy.ts 中间件 rewrite → **静默丢弃**（请求穿透，路径 404）。

因此生产由 **edgeone.json 的 `rewrites`** 在边缘层完成改写（已实证生效）：

- 枚举 zh 顶级区段：`/`、`/tools(/|/*)`、`/blog(/|/*)`、`/links*`、`/contact*`
  → `/zh/…`。**新增顶级页面必须在 edgeone.json 里补一条 rewrite**。
- 语法坑：`X/*` 的 `*` 不匹配空串——`/tools/`（区根）必须另加精确规则
  `/tools` 与 `/tools/`；`X*` 前缀式（如 `/links*`）无此问题。
- 副作用：边缘改写读不到 cookie/Accept-Language，裸路径（含 `/`）一律出
  zh 内容；偏好 en 的用户需经站内切换（NEXT_LOCALE cookie → /en/ 链接）。

本地开发（无 edgeone.json）由 [proxy.ts](../../proxy.ts) 的 `intlMiddleware`
完成同样的改写（cookie `NEXT_LOCALE` → `Accept-Language` 权重 → 默认 `zh`），
非默认语言的无前缀请求以重定向应答。

## 3. 裸根兜底（`/`）

[app/route.ts](../../app/route.ts) 是动态兜底处理器：执行与 intlMiddleware 相同
的协商（`NEXT_LOCALE` cookie → `Accept-Language` 权重 → 默认 `zh`），以**临时重
定向**应答到 `/<locale>/`。本地与生产中它通常不可达（middleware / 边缘 rewrites
先行）——**绝不要在这里用 `NextResponse.rewrite()`**（EdgeOne 上 500），
保持重定向降级。

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
[messages/zh/](../../messages/zh/) /
[messages/en/](../../messages/en/)——按域拆分（core/admin/home/blog/links/
contact/tools/unit），由各 locale 的 `index.ts` 聚合。TSX 中硬编码含人类语言词的
`aria-label="…"` 会让测试失败。例外：机器专用属性
（`aria-current="page"`、`data-*`、CSS 类名）。

链接原语与请求配置在
[i18n/navigation.ts](../../i18n/navigation.ts) /
[i18n/request.ts](../../i18n/request.ts)——需要区域感知的 href 时用它们，
不要用裸 `<a>`/`Link`。

## 6. 红旗信号

- 在 app/ 组件里硬编码用户可见文案或含人类语言词的 `aria-label`——测试会失败（§5）。
- 用 `NextResponse.rewrite()` 解决 EdgeOne 上的路径改写——Route Handler 显式 500、middleware 静默丢弃（§2）。
- 新增顶级页面却没在 edgeone.json 补 rewrite——生产裸路径 404（§2）。
- 需要区域感知链接时用了裸 `<a>` / `next/link`（§5）。
- 写 `X/*` 改写规则后没有为区根补精确规则——`*` 不匹配空串（§2）。
- zh.json / en.json 只更新了一边——键结构一致由测试强制。

## 7. 合理化防止表

| 借口 | 现实 |
|---|---|
| "这段中文先硬编码，之后再挪进 messages" | "之后"不会来；grep 契约当场拦下（[tests/i18n.test.ts](../../tests/i18n.test.ts)）。 |
| "aria-label 不算用户可见文案" | 含人类语言词的硬编码 aria-label 同样违反铁则（§5）；只有机器专用属性豁免。 |
| "proxy.ts 的 rewrite 不行，那在 app/route.ts 里 rewrite" | EdgeOne 上一律 500（§3）——根路径保持重定向降级。 |
| "给裸路径加服务端语言协商，en 用户就不用点切换了" | 边缘改写读不到 cookie/Accept-Language（§2）——协商无从谈起，用站内切换链接。 |
| "两个 messages 文件各加各的，键名对不齐没关系" | 键结构一致由测试强制；zh/en 必须同一提交同步加键。 |
| "本地 dev 能跑，rewrite 的平台差异不重要" | 本地是 proxy.ts 改写，生产是 edgeone.json 改写——两条通道行为不同（§2），以生产为准。 |
