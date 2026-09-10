---
name: "clerk-edge-auth"
description: "本仓库的 Clerk 认证知识：proxy.ts 中间件组合、Clerk v7 Show 组件、EdgeOne 边缘函数内的会话 JWT 手动验签（纯 JS RS256）与 x-auth-fail 排障。凡涉及 auth、Clerk、__session、登录门控或 proxy.ts 时调用。"
---

# Clerk 边缘认证

> **铁则**：边缘函数验证会话只认 §3 的八步清单；RS256 验签只用纯 JS `verifyRs256`——绝不"简化"回 `crypto.subtle.verify`。

以下每条规则都可在源码中验证。标准实现在
[functions/api/counter.js](../../functions/api/counter.js)；测试固定在
[tests/functions.test.ts](../../tests/functions.test.ts)。

## 1. 双认证层

- **Next.js 层** — [proxy.ts](../../proxy.ts) 组合请求时认证：`clerkMiddleware`
  包裹 `intlMiddleware`（保持此顺序）。`config.matcher` 必须保留全部三段：
  静态文件排除正则、`"/(api|trpc)(.*)"`、`'/__clerk/:path*'`（Clerk 自动代理——永远最后）。
- **边缘函数层** — [functions/](../../functions/) 下的 KV 端点**自行**验证 Clerk
  会话（手动 JWT 验签；该环境没有 Clerk SDK 可用）。绝不要把该逻辑挪进
  `app/api/**` Route Handlers。

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

按 `verifyTokenDetailed`（[functions/api/todo.js](../../functions/api/todo.js)）实现：

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
token 在本地 Node 验签正常（所以测试一直全绿）。因此：

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

[tests/functions.test.ts](../../tests/functions.test.ts) 用注入的 JWKS / crypto /
`fetchJwks` 固定所有导出的纯逻辑（`verifyTokenDetailed`、`verifyRs256`、
`isTokenFresh` 等）——不触真实网络。关键用例：issuer/azp 钉死、nbf/sts 关卡、
kid 强制刷新，以及一条 **broken-subtle 回归**（crypto 桩：`importKey`/`verify`
抛异常但 `digest` 可用——模拟边缘环境——RS256 仍须验签通过）。修改导出签名必须
在同一提交中更新该测试。

## 7. 红旗信号

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
