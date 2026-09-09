---
name: "clerk-edge-auth"
description: "本仓库的 Clerk 认证知识：proxy.ts 中间件组合、Clerk v7 Show 组件、EdgeOne 边缘函数内的会话 JWT 手动验签（纯 JS RS256）与 x-auth-fail 排障。凡涉及 auth、Clerk、__session、登录门控或 proxy.ts 时调用。"
---

# Clerk 边缘认证

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

## 3. 会话 JWT 手动验签清单（官方流程）

按 `verifyTokenDetailed`（[functions/api/counter.js](../../functions/api/counter.js)）实现：

1. **解析** `__session` cookie 中的 JWT；格式非法 → 拒绝。
2. **按 `header.alg` 分派**：只有 `ES256` 和 `RS256` 放行。Clerk 实例并不统一——
   dev/test 实例签 ES256，生产实例（`clerk.rdom.cn`）签 RS256。绝不要钉死单一算法。
3. **钉死 issuer** 为 `["https://clerk.<apex>"]`——白名单由部署环境 .env 的
   `SITE_DOMAIN` 派生（`siteApex` 归一化，未配置默认 rdom.cn）。JWKS 只从
   允许列表内的实例获取——token 可控的 `iss` 会让攻击者指向自己的 JWKS（认证绕过）。
4. **校验 `azp`**：存在时对照 `["https://<apex>", "https://www.<apex>"]`（子域
   cookie 泄漏防御；apex 与 www 都收录——缺一则从另一 origin 访问的已登录用户
   会被误判 401）。缺失 azp 允许通过（官方示例行为）。
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
