<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

---

# AGENTS.md — LuckyLab 演示项目工作区规则

<!--
  本文件是项目契约的*索引*：技术栈事实、硬性不变量、质量门禁，以及详细
  知识库的导航图。它刻意保持精简——领域细节契约放在 `skills/` 下的各 skill 中。
  每条规则都与实际源文件交叉引用，agent 可对照源码验证。
-->

## 0. 技术栈与双层架构

- **运行时**：Next.js **16.3.0**（App Router，SSR 模式），经其框架适配器部署到 EdgeOne Pages（[edgeone.json](edgeone.json)：`outputDirectory: ".next"`）——Next.js 服务器直接跑在边缘。React **19.2.8** · TypeScript · next-intl · **Clerk 认证**（`@clerk/nextjs`，密钥在 `.env.local`）· **不用 Tailwind**（纯手写 CSS + CSS 变量）。
- **两层服务端**（保持分离）：
  - **Next.js 层**（[proxy.ts](proxy.ts) + 服务端组件）负责路由、认证中间件组合、区域协商与页面渲染；
  - **EdgeOne Pages 边缘函数**（[functions/](functions/)）承载 KV 支撑的 HTTP API（`/api/presence`、`/api/counter`、`/api/echo`、`/api/headers`）。
  - **不要**把 KV 逻辑挪进 `app/api/**` Route Handlers——边缘函数才是 KV 集成点。
- **UI 风格**：Neo-Brutalism（完整契约见 `neo-brutalism-ui` skill）。

## 1. Skills —— 详细知识库

领域契约位于 `skills/<name>/SKILL.md`（中文撰写）。**动手改某领域前先读对应
skill**；本文件只保留不变量。

| Skill | 触发场景 |
|---|---|
| [`clerk-edge-auth`](skills/clerk-edge-auth/SKILL.md) | 认证、Clerk 组件、`__session`、登录门控、`proxy.ts` 中间件、会话 JWT 验签（含纯 JS RS256 强制要求与 `x-auth-fail` 诊断） |
| [`edgeone-functions-kv`](skills/edgeone-functions-kv/SKILL.md) | `functions/`、KV 存储、`/api/*` 端点、`edgeone.json`、缓存规则、运行时约束 |
| [`neo-brutalism-ui`](skills/neo-brutalism-ui/SKILL.md) | CSS/token、阴影、容器与断点、Nav/dock、动效、图标、主题初始化脚本 |
| [`i18n-locale-routing`](skills/i18n-locale-routing/SKILL.md) | 区域路由与协商、尾斜杠 URL 契约、`app/route.ts` 根路径兜底、`messages/*.json`、CJK-free 规则细节 |

## 2. 硬性约束 —— 不得违反

1. **`proxy.ts` 是唯一的请求时组合点**：`clerkMiddleware` 包裹 `intlMiddleware`（保持此顺序）；`config.matcher` 必须保留全部三段——静态文件排除正则、`"/(api|trpc)(.*)"`、`'/__clerk/:path*'`（永远最后）。
2. **KV 支撑的 API 端点放在 `functions/`，不放 `app/api/**`**（§0）。`dynamic = "force-dynamic"` 只用在真正必需处——依赖认证状态的页面用客户端 `<Show>` 渲染；优先静态/预渲染输出。
3. **`app/**/*.ts(x)` 代码 CJK-free**（字符串字面量、JSX 文本、标识符不得含中日韩字符）；注释中允许中文。由 `tests/i18n.test.ts` 强制——完整范围与机制见 `i18n-locale-routing` skill。
4. **用户可见文案与 ARIA 标签一律走 next-intl**（`useTranslations` / `getTranslations`）。TSX 中硬编码含人类语言词的 `aria-label` 会让测试失败；机器专用属性豁免。
5. **根布局是 `app/` 中唯一的 `<script>` 渲染者**——防 FOUC 主题脚本契约见 `neo-brutalism-ui` skill；由 `tests/theme-i18n.test.ts` 强制执行。
6. **边缘函数中 RS256 绝不使用 Web Crypto**（边缘运行时缺 RSA——改用纯 JS `verifyRs256`）。完整验签清单见 `clerk-edge-auth` skill。
7. **禁止 HTML 边缘缓存**（页面含认证状态 UI → 跨用户缓存泄漏）。缓存规则见 `edgeone-functions-kv` skill。
8. **`@swc/helpers` 固定在 `0.5.17`**，通过 `package.json` → `"overrides"`。只有验证 `next build --webpack` 与 `next dev --turbopack` 都能编译 App Router 之后才可升级。

## 3. 质量门禁（推送前必须全绿）

```bash
npm test     # vitest run —— grep 契约 + 单元测试（含 tests/functions.test.ts）
npm run lint # eslint . via eslint.config.mjs —— TS 规则已启用
npm run build  # next build --webpack
```

- **构建守卫**：构建必须完成并注册 proxy（路由表中出现 `ƒ Proxy (Middleware)`）。`.env.local`（Clerk 密钥）在 dev/build 中自动加载——绝不提交。
- **边缘函数契约**：`functions/*.js` 中的纯逻辑必须导出并由 `tests/functions.test.ts` 固定。修改导出签名必须在同一提交中更新该测试。每个函数文件保持**自包含**（函数间禁止互相 import）。
- `scripts/e2e-cross-feature.cjs` 是手动跨特性矩阵（i18n × 主题），不属于 `npm test`。重命名容器 CSS 类时，须在同一提交中更新其 `document.querySelector(...)` 行。
- `app/[locale]/tools/**/*.ts` 中新增的任何工具逻辑函数必须附带同级 `*.test.ts`——`tests/tools.test.ts` 只覆盖共享助手。

## 4. 删除什么 / 不要创建什么

- **绝不提交会话级 AI 草稿**：`BRANDING.md`、`CLAUDE.md`、`DIAGNOSTIC_REPORT.md`、`QA_REPORT.md` 及类似一次性审计文档不得留在仓库根目录。规则保留在本文件，测试保留在 `tests/`，其余删除。
- **未经要求不要主动创建 `*.md` 文档**。手工维护的项目级文档只有本文件与 `README.md`（`skills/` 下的 skill 文件是第三例外——它们是成体系的知识，不是会话笔记）。

## 5. 速查文件地图

| 关注点 | 位置 |
|---|---|
| 根布局 / metadata / ClerkProvider / `<head>` 中的主题脚本 | [app/[locale]/layout.tsx](app/[locale]/layout.tsx) |
| Proxy（clerkMiddleware × intlMiddleware 组合 + matcher） | [proxy.ts](proxy.ts) |
| 根路径 `/` 兜底（服务端区域重定向；EdgeOne 静态层绕过 proxy.ts） | [app/route.ts](app/route.ts) |
| Morphing Slab 导航 + 认证控件（`Show`、SignIn/SignUp/UserButton） | [app/[locale]/components/Nav.tsx](app/[locale]/components/Nav.tsx) |
| 主题运行时助手（apply/persist/resolve）+ `themeInitScript()` | [app/lib/theme.ts](app/lib/theme.ts) |
| CSS 变量 + 组件类 + dock 外壳（含 `.dock-auth-btn`） | [app/globals.css](app/globals.css) + [app/styles/](app/styles/) |
| i18n 区域路由（`localePrefix: "always"`） | [i18n/routing.ts](i18n/routing.ts) |
| i18n 词表 | [messages/zh.json](messages/zh.json) · [messages/en.json](messages/en.json) |
| i18n 链接原语 / 请求配置 | [i18n/navigation.ts](i18n/navigation.ts) · [i18n/request.ts](i18n/request.ts) |
| Clerk 密钥（绝不提交） | `.env.local` |
| Clerk 组件主题化（`clerkAppearance` + `auth-*` 类） | `app/[locale]/layout.tsx` + [app/styles/clerk.css](app/styles/clerk.css) |
| Presence 心跳（在线人数，KV） | [functions/api/presence.js](functions/api/presence.js) + [Presence.tsx](app/[locale]/components/Presence.tsx) |
| 实时计数器（登录门控，KV；手动 JWT 验签） | [functions/api/counter.js](functions/api/counter.js) + [CounterClient.tsx](app/[locale]/tools/counter/CounterClient.tsx) |
| http-check 调试端点 | [functions/api/echo.js](functions/api/echo.js) · [functions/api/headers.js](functions/api/headers.js) |
| 边缘函数单元测试（假 KV、纯逻辑） | [tests/functions.test.ts](tests/functions.test.ts) |
| RSS 订阅路由 | [app/feed.xml/route.ts](app/feed.xml/route.ts) |
| EdgeOne 部署配置（SSR 输出目录、静态缓存头） | [edgeone.json](edgeone.json) |
| 测试套件（grep 契约 + 单元） | [tests/](tests/) |
| 跨特性 zh/en × 亮暗 E2E 脚本（手动） | [scripts/e2e-cross-feature.cjs](scripts/e2e-cross-feature.cjs) |
| 详细领域契约（auth / KV / UI / i18n） | [skills/](skills/) |
