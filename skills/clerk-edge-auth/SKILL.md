---
name: "clerk-edge-auth"
description: "本仓库的 Clerk 认证知识：proxy.ts 中间件组合、Clerk v7 Show 组件、EdgeOne 边缘函数内的会话 JWT 手动验签（纯 JS RS256）与 x-auth-fail 排障。凡涉及 auth、Clerk、__session、登录门控或 proxy.ts 时调用。"
---

# Clerk 边缘认证

> **铁则**：边缘函数验证会话只认 §3 的八步清单；RS256 验签只用纯 JS `verifyRs256`（由 @lucky/auth-core 统一提供）——绝不"简化"回 `crypto.subtle.verify`。

以下每条规则都可在源码中验证。八步验签的标准实现收敛在 npm 包
@lucky/auth-core（[shared/auth-core](../../shared/auth-core/)——todo.js /
sandboxes.js / agents/code-run / app/lib/session.ts 三层 import 同一份）；
验签矩阵测试固定在 [tests/auth-core.test.ts](../../tests/auth-core.test.ts)，
集成与业务用例固定在 [tests/functions.test.ts](../../tests/functions.test.ts)。

## 1. 双认证层

- **Next.js 层** — [proxy.ts](../../proxy.ts) 组合请求时认证：`clerkMiddleware`
  包裹 `intlMiddleware`（保持此顺序）。`config.matcher` 必须保留全部三段：
  静态文件排除正则、`"/(api|trpc)(.*)"`、`'/__clerk/:path*'`（Clerk 自动代理——永远最后）。
- **边缘函数层** — [functions/](../../functions/) 下的 KV 端点**自行**验证 Clerk
  会话（手动 JWT 验签；该环境没有 Clerk SDK 可用）。绝不要把该逻辑挪进
  `app/api/**` Route Handlers。

### 1.1 EdgeOne 生产：SSR 页面禁用 `auth()`（2026-09 生产事故）

EdgeOne 适配器**不透传 clerkMiddleware 的请求装饰**（与 intl 重写被丢弃同源）：
生产 SSR 页面 / server action 里调用 `auth()` 必抛 "Clerk can't detect usage of
clerkMiddleware()" → 500；本地 `next dev` 完全正常（纯环境差异，三门禁测不出）。
客户端组件（`<Show>` / `useUser`）不受影响（走 ClerkProvider + Frontend API）。

**服务端需要会话时的正解**——[app/lib/session.ts](../../app/lib/session.ts) 的
`readSessionClaims()`：读 `__session` cookie 后自行验签，**验签通道按序取
第一条可用**（2026-09 生产事故后的三通道架构）：

1. **PEM 通道**（`CLERK_JWT_PUBLIC_KEY`，Dashboard → API keys → Public
   key）：verifyToken 原生 `jwtKey` 路径，networkless——已配置的环境最优，
   也是免 JWKS 获取 RTT 的性能余量。仅适用 RS256 实例；支持 `\n` 转义。
2. **JWKS 通道（生产默认）**：token iss 命中白名单（`CLERK_ISSUER` 显式
   列表，或 `SITE_DOMAIN` 派生 `https://clerk.<apex>`——派生规则与边缘
   函数逐字对齐，未配置默认 rdom.cn）→ 包内 `verifySessionDetailed`
   （@lucky/auth-core，八步逐关）从该 iss 的公开端点
   `<iss>/.well-known/jwks.json` 取公钥（模块级缓存 + kid 未命中强制
   刷新自愈；issuer 白名单 / alg ES256+RS256 / 5s 时钟容差由包逐关强制）。
   **存在理由**：verifyToken 的 SK 回源打 `api.clerk.com/v1/jwks`，生产
   环境出网不可达（线上 verify-failed 且摘要为空）——工具页边缘函数
   正是靠这条自定义域 JWKS 通道一直正常。安全关卡同边缘函数：JWKS URL
   只按白名单条目构造，绝不从 token iss 直接构造。
3. **SK 回源兜底**：iss 不在白名单（本地 dev 实例 accounts.dev）时走
   verifyToken + `CLERK_SECRET_KEY`——本地网络可达 api.clerk.com。

`CLERK_SECRET_KEY` 始终必需（用户搜索 / 角色管理的 clerkClient 用）。
诊断三件套：reason（no-cookie / no-key / verify-failed / issuer-mismatch）
+ detail（错误摘要——message → reason → JSON 三级兜底，绝不允许空白）
+ input（`via=<pem|jwks|sk>` 通道标记 + sk/pem 存在性与形态摘要），门控页
就地展示诊断卡并内嵌 AdminClientProbe（客户端 useUser 对照——客户端已
登录而服务端 verify-failed 即出网/通道问题；探针无角色即 metadata 未
注入或令牌未刷新）。**"一点击就跳首页"式静默失败是排障的头号敌人**——
与边缘函数 `x-auth-fail` 响应头同一哲学。
- **issuer / azp 的校验语义随通道而异**：JWKS 通道的 iss 白名单是**必需
  关卡**（包内 `verifySessionDetailed` 的 `allowedIssuers` 参数，验签时
  强制）——与边缘函数 §3.3 同理（防
  任意 iss + 自造 JWKS 伪造身份）。PEM / SK 通道签名绑定实例，iss 校验
  仅在 `CLERK_ISSUER` 显式设置时执行（claimsGate）。azp 在两处均为可选
  加固：`CLERK_AZP_ORIGINS` 设置时，azp 存在且不命中才拒绝（缺失放行
  ——旧实例可能不带 azp）。
- 先例：admin 页面门控（readAdminAccess 判别联合四态：面板 / no-key
  指引 / no-session 诊断 / not-admin 说明）与角色 server actions
  （readAdminClaims 静默拒绝）均走该路径。

## 2. Clerk v7 组件 API（相对旧版为破坏性变更）

`SignedIn` / `SignedOut` 在 Clerk v7 中**已移除**。改用 `<Show>`：

```tsx
<Show when="signed-out"><SignInButton mode="modal" /><SignUpButton mode="modal" /></Show>
<Show when="signed-in"><UserButton /></Show>
```

实际用法：[Nav.tsx](../../app/[locale]/components/Nav.tsx)（dock 认证控件）。
组件主题化：[app/[locale]/layout.tsx](../../app/[locale]/layout.tsx) 中的
`clerkAppearance`，加上 [app/styles/clerk.css](../../app/styles/clerk.css) 中的
`auth-*` 类。

### 2.1 退出登录在子页报 "An unexpected response was received from the server."（已打补丁）

- **根因（@clerk/nextjs ^7.9.1 与 clerk-js 的契约裂缝）**：ClerkProvider 在
  `window.__internal_onBeforeSetActive` 里对 Next 15+ 的 sign-out 做了 noop 短路
  （登出后由 `__internal_onAfterSetActive` 的 `router.refresh()` 补偿），但短路条件
  是 `intent === "sign-out"`；而 clerk-js 的 `signOut()` 调用该钩子时**不传参数**
  （minified 源码 `await i()`）→ 短路永不命中 → 回退执行 `invalidateCacheAction()`
  （server action POST）。
- **为什么只有首页正常**：EdgeOne 静态层对**有缓存副本的预渲染页面 URL** 的 POST
  直接回 200 缓存 HTML（`EO-Cache-Status: Cache Hit`，请求从未到达 Next 服务器）；
  Next 客户端发现 content-type 非 `text/x-component` 即抛此错。首页 `/zh/` 的 POST
  恰好穿透静态层（Cache Miss）→ Next 返回 404 + `X-Nextjs-Action-Not-Found: 1`，
  Next 16 客户端对此优雅处理。同类陷阱：**不要给预渲染页面发 server action POST**
  （EdgeOne 缓存规则见 `edgeone-functions-kv` skill）。
- **补丁**：[ClerkSignOutPatch.tsx](../../app/[locale]/components/ClerkSignOutPatch.tsx)
  在 ClerkProvider 注册钩子后覆盖之（父级 useSafeLayoutEffect 属 layout 阶段、补丁
  useEffect 属 passive 阶段，顺序由 React 保证；带 cleanup 恢复原实现）——intent 为
  `undefined` 或 `"sign-out"` 时一律 noop resolve，其余透传。挂在
  [layout.tsx](../../app/[locale]/layout.tsx) 的 `NextIntlClientProvider` 内。
  **升级 @clerk/nextjs 时重新评估**：若上游修复了 intent 传参匹配，此补丁与组件可删。

## 3. 会话 JWT 手动验签清单（官方流程）

验签实现已收敛至 @lucky/auth-core 包（`verifySessionDetailed`，源在
[shared/auth-core/verify.js](../../shared/auth-core/verify.js)；todo.js /
sandboxes.js / agents / SSR 三层 import 同一份），本节保留八步清单语义与
诊断契约：

1. **解析** `__session` cookie 中的 JWT；格式非法 → 拒绝。
2. **按 `header.alg` 分派**：只有 `ES256` 和 `RS256` 放行。Clerk 实例并不统一——
   dev/test 实例签 ES256，生产实例（`clerk.rdom.cn`）签 RS256。绝不要钉死单一算法。
3. **钉死 issuer** 为 `["https://clerk.<apex>"]`——白名单由部署环境 .env 的
   `SITE_DOMAIN` 派生（`siteApex` 归一化，未配置默认 rdom.cn）。JWKS 只从
   允许列表内的实例获取——token 可控的 `iss` 会让攻击者指向自己的 JWKS（认证绕过）。
4. **校验 `azp`**：存在时其 host 须为本站 apex 或其任意子域（`isAllowedAzp`
   按 `.<apex>` 后缀点边界匹配——子域 cookie 泄漏防御的同时，所有自家子域
   共享同一身份）。缺失 azp 允许通过（官方示例行为）。
5. **时间窗**：`exp`/`nbf` 双侧留 `CLOCK_SKEW_S = 5` 秒容差（对应 Clerk SDK
   默认 `clockSkewInMs: 5000`）。
6. **`sts` 声明**：存在且不为 `"active"` → 拒绝。
7. **选钥**：用 `header.kid` 匹配实例 JWKS（`<iss>/.well-known/jwks.json`，
   模块级缓存 1 小时）。kid 未命中时**强制刷新 JWKS 一次**并重试（自愈密钥轮换
   与过期缓存）。
8. **验签**（见 §4），通过后信任 `payload.sub` 为 uid。

## 4. RS256 禁用 Web Crypto —— 纯 JS BigInt 验签

**生产事故**：EdgeOne 边缘运行时的 `crypto.subtle` 不支持 RSA——所有 RS256
`importKey`/`verify` 调用直接抛异常，线上表现为 `x-auth-fail: crypto`，而同一
token 在本地 Node 验签正常（所以测试一直全绿）。`verifyRs256` /
`verifyEs256` 均已收敛至 @lucky/auth-core（verify.js）——三层共用同一份
实现，不再各自持有副本。因此：

- **RS256** → `verifyRs256`：纯 JS 实现 RFC 8017 RSASSA-PKCS1-v1_5——BigInt
  `modPow`（`s^e mod n`，e=65537 仅 17 bit → 亚毫秒级）、EMSA-PKCS1-v1_5 填充块
  比对（`00 01 FF..FF 00 ‖ DigestInfo(SHA-256) ‖ hash`）、摘要走
  `crypto.subtle.digest("SHA-256")`（边缘**确实支持**）。单一确定性路径——不要
  "简化"回 `crypto.subtle.verify`。
- **ES256** → 标准 `crypto.subtle.importKey("jwk", …)` + `verify`（ECDSA P-256
  在边缘可用，保留 WebCrypto 路径）。

## 5. 生产诊断：`x-auth-fail` 响应头

todo 端点的 401 响应携带 `x-auth-fail`，值为命中的确切失败关卡：

```
parse | alg:<x> | iss | azp | nbf | exp | sts | kid | sig | crypto | no-cookie | sub
```

动态值经 `sanitizeTag`（`/^[\w.:-]{1,32}$/`）消毒。排障配方：读一次响应头即可
精确定位失败步骤，无需猜测（§4 的边缘 RSA 缺口就是这样一轮定位的）。

## 6. 测试契约

验签矩阵的单一真源测试在
[tests/auth-core.test.ts](../../tests/auth-core.test.ts)：注入 JWKS / crypto /
`fetchJwks` 固定 @lucky/auth-core 的全部验签导出（`verifySessionDetailed`、
`verifyRs256`、`isTokenFresh` 等）——不触真实网络。关键用例：issuer/azp 钉死、
nbf/sts 关卡、kid 强制刷新，以及一条 **broken-subtle 回归**（crypto 桩：
`importKey`/`verify` 抛异常但 `digest` 可用——模拟边缘环境——RS256 仍须验签
通过）。[tests/functions.test.ts](../../tests/functions.test.ts) 保留 re-export
冒烟（钉住 todo.js 链路）与 todo 业务用例；
[tests/session.test.ts](../../tests/session.test.ts) 固定 SSR 通道链。修改包
导出签名必须在同一提交中核对 functions / agents / app 三处调用点并更新
对应测试（见 AGENTS.md 同步表）。

## 7. 红旗信号

- 生产 SSR 页面 / server action 里调用 `auth()`——EdgeOne 不透传 clerkMiddleware，改用 `readSessionClaims()`（§1.1）。
- 门控失败静默 `redirect` 首页——失败必须就地展示 reason + detail 诊断卡，"跳首页"式不可见故障无法排障（§1.1）。
- 在边缘函数里对 RS256 调用 `crypto.subtle.importKey`/`verify`——立刻停（生产事故根源，见 §4）。
- 把验签逻辑挪进 `app/api/**` 或 Next.js 层"复用"——两层各司其职（§1）。
- 用 token 里的 `iss` 直接构造 JWKS URL 而不经允许列表——认证绕过（§3.3）。
- 验签八步清单跳步——每步对应一类攻击面（iss 伪造、kid 混淆、时间窗重放……）。
- 升级 `@clerk/nextjs` 时顺手删除 ClerkSignOutPatch——必须先验证上游已修复 intent 传参（§2.1）。
- 新增/修改函数导出签名而未在同一提交更新 [tests/functions.test.ts](../../tests/functions.test.ts)。

## 8. 合理化防止表

| 借口 | 现实 |
|---|---|
| "本地/CI 测试全绿，边缘环境一定也一样" | 正是这个想法放过了一次生产事故（§4）。测试桩必须模拟边缘缺口——broken-subtle 回归就是为此存在。 |
| "钉死一种签名算法更简单" | Clerk 实例不统一：dev/test 签 ES256，生产签 RS256（§3.2）。按 `header.alg` 分派。 |
| "kid 未命中就直接 401 吧" | 必须强制刷新 JWKS 一次再重试——这是密钥轮换的自愈路径（§3.7）。 |
| "token 的 iss 说它是谁就是谁" | `iss` 必须钉死在允许列表（§3.3）——token 可控的 iss 会把 JWKS 指向攻击者。 |
| "八步清单太长，挑关键的做" | 每一步都对应一次真实攻击面或真实故障；§5 的 `x-auth-fail` 头就是逐关设计的。 |
