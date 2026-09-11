# 身份验证模块重构（验签统一进 @lucky/auth-core）实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 subagent-driven-development（推荐）或 executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 验签实现四份合并为一份——八步验签核心抽入 `@lucky/auth-core` npm 包，todo.js / sandboxes.js / agents/code-run 全部 import 薄包装；SSR 的 JWKS 通道改调包内实现（PEM/SK 通道保留 `verifyToken`），并删除 jose 依赖。

**架构：** `@lucky/auth-core` 拆为 predicates（纯判定，现有）/ keys（JWKS 获取+缓存）/ verify（八步逐关+RS256 BigInt+ES256 subtle）三模块，index.js 聚合导出并附 index.d.ts 类型声明。SSR 通道链保持 PEM → JWKS → SK 回源不变，诊断 detail 升级为逐关码。provider 适配层（clerkProvider）预留换体系能力。

**技术栈：** 纯 JS（JSDoc 类型）npm 包（file: 依赖）· Node 22 全局 fetch/crypto 同构 · vitest · Next 16。

**规格：** docs/superpowers/specs/2026-09-11-auth-verification-refactor-design.md

## 全局约束

- 边缘运行时 `crypto.subtle` 不支持 RSA——RS256 只能走纯 JS BigInt 路径（verifyRs256），绝不改回 `subtle.verify`
- 包零 npm 依赖、零 env 读取；env 派生（SITE_DOMAIN / CLERK_ISSUER）留在调用方
- `npm test` / `npm run lint` / `npm run build`（路由表含 `ƒ Proxy (Middleware)`）三门禁每任务收尾必须全绿
- app/** 代码 CJK-free（注释可中文）；commit 英文 conventional（PowerShell 多 `-m`）
- 测试为英文注释；既有测试注入签名（jwks/now/crypto/fetchJwks/allowedIssuers/azpApex）保持不变
- 每任务收尾：`node scripts/_tmp-*.cjs` 类临时脚本一律删除

## 文件结构

```
shared/auth-core/
├── package.json        （不变）
├── index.d.ts          （新建：全导出 TS 声明——agents/.ts 目标 import 的类型来源）
├── index.js            （改为聚合：export * from 三模块 + 兼容 re-export）
├── predicates.js       （新建：现 index.js 的纯判定原样迁入）
├── keys.js             （新建：JWKS 缓存 + getJwks，自 todo.js L422-441 移植）
└── verify.js           （新建：base64UrlDecode/parseTokenPayload/isTokenFresh/RS256 段/
                          sanitizeTag/verifySessionDetailed，自 todo.js L272-562 移植）
tests/auth-core.test.ts（新建：验签矩阵，单一真源测试）
tests/helpers/sign-jwt.ts（新建：ES256/RS256 签名基建，自 code-run.test.ts 抽取）
functions/api/todo.js          （删验签段 → 薄包装 + re-export）
functions/api/sandboxes.js     （同上）
agents/code-run/index.ts       （删 TS 验签段 → 薄包装）
app/lib/session.ts             （JWKS 通道切包；删 jose import）
package.json / package-lock.json（删 jose）
tests/session.test.ts / tests/functions.test.ts / tests/code-run.test.ts（去重）
```

---

### 任务 1：auth-core 拆分三模块 + 移植验签核心（纯新增，不改调用方）

**文件：**
- 创建：`shared/auth-core/predicates.js`（自现 index.js 原样迁移，见步骤 1）
- 创建：`shared/auth-core/keys.js`
- 创建：`shared/auth-core/verify.js`
- 创建：`shared/auth-core/index.d.ts`
- 修改：`shared/auth-core/index.js`（替换为聚合导出）
- 测试：`tests/helpers/sign-jwt.ts`、`tests/auth-core.test.ts`

- [ ] **步骤 1.1：迁移 predicates.js**

现 `shared/auth-core/index.js` 的全部内容（DEFAULT_SITE_APEX / ADMIN_ROLE / siteApex / normalizeIssuer / parseList / deriveIssuers / isAllowedAzp / roleFromClaims，含全部 JSDoc 注释）原样移动到 `shared/auth-core/predicates.js`——无任何代码修改，仅文件名变化。文件头注释保留并追加一行说明“由 index.js 聚合导出”。

- [ ] **步骤 1.2：创建 keys.js（自 todo.js L422-441 移植）**

```js
/**
 * JWKS 获取与缓存（单一真源 @lucky/auth-core）。
 * 模块级缓存：iss → { keys, expiresAt }，TTL 1 小时；forceRefresh 跳过
 * 缓存读取（kid 未命中的自愈路径），刷新结果仍写回缓存。
 */
export const JWKS_TTL_MS = 3_600_000;

const jwksCache = new Map();

export async function getJwks(issuer, { forceRefresh = false } = {}) {
  const iss = String(issuer).replace(/\/+$/, "");
  const cached = jwksCache.get(iss);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.keys;

  const res = await fetch(`${iss}/.well-known/jwks.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`jwks-http-${res.status}`);
  const data = await res.json();
  const keys = Array.isArray(data?.keys) ? data.keys : null;
  if (!keys) throw new Error("jwks-shape");
  jwksCache.set(iss, { keys, expiresAt: Date.now() + JWKS_TTL_MS });
  return keys;
}

/** 测试专用：清空模块级 JWKS 缓存（跨用例隔离）。 */
export function resetJwksCache() {
  jwksCache.clear();
}
```

- [ ] **步骤 1.3：创建 verify.js（自 todo.js L272-562 移植）**

移植函数与来源行号（代码原样，仅以下三处适配）：
- `base64UrlDecode`（todo.js L272-280）→ 原样
- `parseTokenPayload`（L282-305）→ 原样，导出
- `isTokenFresh`（L307-317）→ 原样，导出（向后兼容既有测试）
- RS256 段（L319-420：SHA256_DIGEST_INFO/bytesToBigInt/bigIntToBytes/modPow/verifyRs256）→ 原样，verifyRs256 导出
- `getJwks`（L429-441）→ **删除**（改从 `./keys.js` import）
- `sanitizeTag`（L443-447）→ 原样，不导出（模块内使用）
- `verifyTokenDetailed`（L449-549）→ **重命名为 `verifySessionDetailed`**，默认参数改两处：
  - `fetchJwks = getJwks` → 改为 `import { getJwks } from "./keys.js"` 后 `fetchJwks = getJwks`（行为不变）
  - `allowedIssuers = ALLOWED_ISSUERS` → **删除默认值**，改为必传参数化（包不读 env）：签名 `{ ..., allowedIssuers, azpApex } = {}`——allowedIssuers/azpApex 缺省时跳过对应校验？**否**——保持必传语义：缺省时按空处理会导致全部拒绝（fail-closed）。实现：`allowedIssuers = [], azpApex = ""`，iss 校验 `!allowedIssuers.map(normalizeIssuer).includes(iss)` 空数组自然拒绝；azp 同 todo 现逻辑（azpApex 非字符串 → isAllowedAzp 返回 false——但 azp 缺失仍放行，语义不变）
- `verifySessionToken`（L551-562）→ 原样（内部调 verifySessionDetailed）
- **新增** `verifyEs256(jwk, signingInput, signature, cryptoObj)`：从 verifyTokenDetailed 的 ES256 分支（L534-548）抽出为独立导出函数，verifySessionDetailed 内改调它（与 verifyRs256 对称；为 ES256 单测铺路）

文件头 JSDoc 注明：八步清单说明自 todo.js 顶部对应注释一并迁移；`normalizeIssuer`/`isAllowedAzp` 改从 `./predicates.js` import。

- [ ] **步骤 1.4：index.js 改为聚合 + 新建 index.d.ts**

```js
/** @lucky/auth-core 出口聚合。 */
export * from "./predicates.js";
export * from "./keys.js";
export * from "./verify.js";
```

`index.d.ts`（手工声明，供 agents/.ts 目标 import）：

```ts
export const DEFAULT_SITE_APEX: string;
export const ADMIN_ROLE: string;
export const JWKS_TTL_MS: number;
export function siteApex(raw: unknown): string | null;
export function normalizeIssuer(value: unknown): string;
export function parseList(raw: string | undefined): string[] | null;
export function deriveIssuers(env?: {
  siteDomain?: string;
  clerkIssuer?: string;
}): string[];
export function isAllowedAzp(azp: unknown, apex: unknown): boolean;
export function roleFromClaims(
  payload: Record<string, unknown> | null | undefined,
): string;
export function resetJwksCache(): void;
export function getJwks(
  issuer: string,
  opts?: { forceRefresh?: boolean },
): Promise<Array<Record<string, unknown>>>;
export function parseTokenPayload(token: unknown): {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signingInput: string;
  signature: Uint8Array;
} | null;
export function isTokenFresh(payload: unknown, now?: number): boolean;
export function verifyRs256(
  jwk: Record<string, unknown>,
  signingInput: string,
  signature: Uint8Array,
  cryptoObj: Crypto,
): Promise<boolean>;
export function verifyEs256(
  jwk: Record<string, unknown>,
  signingInput: string,
  signature: Uint8Array,
  cryptoObj: Crypto,
): Promise<boolean>;
export function verifySessionDetailed(
  token: unknown,
  deps?: {
    jwks?: Array<Record<string, unknown>> | null;
    now?: number;
    crypto?: Crypto;
    fetchJwks?: (
      issuer: string,
      opts?: { forceRefresh?: boolean },
    ) => Promise<Array<Record<string, unknown>>>;
    allowedIssuers?: string[];
    azpApex?: string;
  },
): Promise<
  { ok: true; payload: Record<string, unknown> } | { ok: false; reason: string }
>;
export function verifySessionToken(
  token: unknown,
  deps?: Parameters<typeof verifySessionDetailed>[1],
): Promise<Record<string, unknown> | null>;
```

- [ ] **步骤 1.5：新建 tests/helpers/sign-jwt.ts（自 code-run.test.ts 的签名基建抽取）**

读取 `tests/code-run.test.ts` 中生成 ES256/RS256 密钥对与签发 JWT 的辅助函数（生成 EC/RSA WebCrypto 密钥对 + 手工 JWS 签名），原样抽到 `tests/helpers/sign-jwt.ts` 并导出：`generateEs256Keys()`、`generateRs256Jwk()`（或文件中实际存在的等价函数名——以 code-run.test.ts 现状为准，不改变其算法）。code-run.test.ts 改从 helper import。

- [ ] **步骤 1.6：编写 tests/auth-core.test.ts（先于实现确认失败——若步骤 1.1-1.4 已实现则直接验证通过）**

覆盖矩阵（全部走 `verifySessionDetailed` 注入式调用，零网络）：

```ts
import { describe, expect, it, vi } from "vitest";
import {
  deriveIssuers,
  isTokenFresh,
  parseTokenPayload,
  verifySessionDetailed,
  siteApex,
} from "@lucky/auth-core";
import { generateEs256Keys, generateRs256JwkAndSign } from "./helpers/sign-jwt";
```

用例清单（每个 it 一行断言意图）：
1. ES256 合法令牌（注入 jwks = [公开 JWK]）→ `{ ok: true }` 且 payload.sub 正确
2. RS256 合法令牌（同上，RSA 路径）→ 通过（边缘缺口回归）
3. 畸形 token（"not-a-jwt"）→ reason "parse"
4. alg 非 ES256/RS256（HS256）→ reason "alg:HS256"
5. iss 不在白名单 → reason "iss"；白名单含尾斜杠 → 命中（归一化）
6. azp 指向 evil.com → reason "azp"；azp 缺失 → 放行
7. exp 已过期（now 注入 +61s）→ reason "exp"；恰好 +59s → 通过（clock skew）
8. nbf 未来 → reason "nbf"
9. sts 非 "active" → reason "sts"；缺失 → 放行
10. kid 不在注入 jwks → reason "kid"
11. 篡改签名 → reason "sig"
12. RS256 注入 EC 密钥（kty 不匹配）→ reason "crypto" 或 "sig"（异常路径）
13. fetchJwks 注入：kid 未命中时以 forceRefresh:true 被调用一次（vi.fn 计数）
14. allowedIssuers 缺省（空）→ 任何 iss 均拒绝（fail-closed）
15. siteApex / deriveIssuers / isTokenFresh / parseTokenPayload 的既有断言（自 session.test.ts / code-run.test.ts 收敛）

- [ ] **步骤 1.7：运行包测试 + 全量三门禁**

运行：`npm test`（vitest 直跑，包经 node_modules 解析）、`npm run lint`、`npm run build`
预期：全部 PASS/零告警/含 Proxy。既有 todo/code-run 测试**不受影响**（本任务纯新增）。

- [ ] **步骤 1.8：Commit**

```bash
git add shared/auth-core tests/auth-core.test.ts tests/helpers/sign-jwt.ts tests/code-run.test.ts
git commit -m "feat(auth-core): absorb the eight-step session verifier as the single source"
```

---

### 任务 2：todo.js / sandboxes.js 切换薄包装

**文件：**
- 修改：`functions/api/todo.js`（删 L272-562 验签段与 L422-441 JWKS 段）
- 修改：`functions/api/sandboxes.js`（同构删改）
- 测试：`tests/functions.test.ts`（删除与 auth-core 重复的纯算法用例）

- [ ] **步骤 2.1：todo.js 换 import + 薄包装**

文件头（JSDoc 之后）加：

```js
import {
  DEFAULT_SITE_APEX,
  isAllowedAzp,
  normalizeIssuer,
  siteApex,
  verifySessionDetailed,
} from "@lucky/auth-core";

// 共享判定与验签核心 re-export（单一真源 @lucky/auth-core，供测试与上层复用）。
export { isAllowedAzp, siteApex, verifyRs256, verifySessionToken } from "@lucky/auth-core";
```

删除（已被包取代）：base64UrlDecode / parseTokenPayload / isTokenFresh / RS256 段（SHA256_DIGEST_INFO 至 verifyRs256）/ jwksCache + getJwks / sanitizeTag / verifyTokenDetailed 本体 / verifySessionToken 本体。

将原 `verifyTokenDetailed` 改为**适配包装**（保持导出名与注入字段不变，tests/functions.test.ts 的注入式用例零改动）：

```js
export async function verifyTokenDetailed(
  token,
  { jwks = null, now = Date.now(), crypto: cryptoObj = globalThis.crypto, fetchJwks, allowedIssuers = ALLOWED_ISSUERS, azpApex = SITE_APEX } = {},
) {
  return verifySessionDetailed(token, {
    jwks,
    now,
    crypto: cryptoObj,
    ...(fetchJwks ? { fetchJwks } : {}),
    allowedIssuers,
    azpApex,
  });
}
```

保留：readSessionToken / readSessionUid / 业务段（normalizeItems/addTodo/updateTodo/removeTodo/loadItems/saveItems/readJsonBody/onRequest*）。`SITE_APEX` 派生行保持（`?? DEFAULT_SITE_APEX`）。

- [ ] **步骤 2.2：sandboxes.js 同构改造**

与 todo.js 相同的删除与包装（其 `verifyTokenDetailed` 副本 → 调 `verifySessionDetailed` 的薄包装；siteApex/SITE_APEX/ALLOWED_ISSUERS 同构）。此步同时修复 B2 漂移（获得 CLERK_ISSUER 支持——`allowedIssuers` 派生若 sandboxes 有对应 env 读取则沿用其现状，派生函数来自包）。

- [ ] **步骤 2.3：tests/functions.test.ts 去重**

删除与 `tests/auth-core.test.ts` 重复的纯算法用例（RS256 数学细节、siteApex/isAllowedAzp 全矩阵——保留 2-3 条冒烟断言确认 re-export 链路）；保留 todo 业务（todoKey/addTodo/updateTodo/removeTodo/normalizeItems）与 verifyTokenDetailed 注入式集成用例。

- [ ] **步骤 2.4：运行测试 + 三门禁**

运行：`npm test`、`npm run lint`、`npm run build`
预期：全绿（含 `--check` 已随测试脚本移除后无影响——本任务后 test 脚本为纯 vitest run）。

- [ ] **步骤 2.5：Commit**

```bash
git add functions/api/todo.js functions/api/sandboxes.js tests/functions.test.ts
git commit -m "refactor(edge): reuse @lucky/auth-core verifier in todo and sandboxes functions"
```

---

### 任务 3：agents/code-run 切换薄包装

**文件：**
- 修改：`agents/code-run/index.ts`（删 TS 验签段）
- 测试：`tests/code-run.test.ts`（去重）

- [ ] **步骤 3.1：删 TS 验签段，换包调用**

删除（L472-810 区域）：Jwk/JwkKeys 类型保留（AgentVerifyDeps 用）、base64UrlDecode、parseTokenPayload（TS 版）、isTokenFresh、RS256/ES256 段、jwksCache/getJwks、sanitizeTag、normalizeIssuer 已删（现由包 re-export 提供）、verifyAgentSession 本体。

`verifyAgentSession` 改为薄包装（保持 AgentVerifyDeps 注入字段与返回形状）：

```ts
export async function verifyAgentSession(
  token: unknown,
  { jwks = null, now = Date.now(), crypto: cryptoObj = globalThis.crypto, fetchJwks, allowedIssuers, azpApex = DEFAULT_SITE_APEX }: AgentVerifyDeps = {},
) {
  const result = await verifySessionDetailed(token, {
    ...(Array.isArray(jwks) ? { jwks } : {}),
    now,
    crypto: cryptoObj,
    ...(fetchJwks ? { fetchJwks } : {}),
    allowedIssuers: allowedIssuers ?? [`https://clerk.${azpApex}`],
    azpApex,
  });
  return result;
}
```

`readAgentSessionUid` 不变（内部 verifyAgentSession 调用与 roleFromClaims（包 re-export）不受影响）。`sanitizeTag` 留在 agents（x-auth-fail 头消毒属响应层）。DEFAULT_ADMIN_ROLE 保持 `= ADMIN_ROLE`。

- [ ] **步骤 3.2：tests/code-run.test.ts 去重**

删除与 auth-core.test.ts 重复的纯算法用例（siteApex/isAllowedAzp/roleFromClaims 全矩阵——保留各 1 条冒烟）；保留 verifyAgentSession 注入式用例、readAgentSessionUid、配额、execute 等业务用例。签名基建改从 `./helpers/sign-jwt` import。

- [ ] **步骤 3.3：运行测试 + 三门禁**

运行：`npm test`、`npm run lint`、`npm run build`
预期：全绿。

- [ ] **步骤 3.4：Commit**

```bash
git add agents/code-run/index.ts tests/code-run.test.ts
git commit -m "refactor(agents): reuse @lucky/auth-core verifier in code-run agent"
```

---

### 任务 4：SSR JWKS 通道切包 + 删除 jose

**文件：**
- 修改：`app/lib/session.ts`
- 修改：`package.json`、`package-lock.json`（删 jose）
- 测试：`tests/session.test.ts`（jose mock → fetch mock）

- [ ] **步骤 4.1：session.ts 通道 2 改调包实现**

import 变更：

```ts
import { verifyToken } from "@clerk/nextjs/server";
import { decodeJwt, verifySessionDetailed } from "@lucky/auth-core";
import { deriveIssuers, normalizeIssuer, parseList, siteApex } from "@lucky/auth-core";
```

（decodeJwt 自包获取后 jose import 整行删除；两行 import 可合并为一行。）

通道 2（`matchAllowedIssuer` 命中分支）替换为：

```ts
    // 通道 2：JWKS（token iss 命中白名单——工具页同款公开端点，包内八步验签）。
    const issuer = matchAllowedIssuer(token, issuers);
    if (issuer) {
      const azpApex = siteApex(issuer) ? siteApex(issuer).replace(/^clerk\./, "") : "";
      const result = await verifySessionDetailed(token, {
        allowedIssuers: [issuer],
        azpApex,
      });
      if (!result.ok) {
        return {
          claims: null,
          reason: result.reason === "iss" ? "issuer-mismatch" : "verify-failed",
          detail: result.reason,
          input: describeVerifyInput(undefined, "jwks"),
        };
      }
      const claims = result.payload as SessionClaims;
      const azp = typeof claims.azp === "string" ? claims.azp : null;
      if (azpAllowlist && azp && !azpAllowlist.includes(azp)) {
        return {
          claims: null,
          reason: "verify-failed",
          detail: `azp mismatch: ${azp}`,
          input: describeVerifyInput(undefined, "jwks"),
        };
      }
      return { claims, reason: null, detail: null, input: null };
    }
```

catch 分支维持不变（包抛错仍 fail-closed 成 verify-failed + detail）。通道 1/3（PEM/SK verifyToken）与 matchAllowedIssuer（decodeJwt 自包）不动。

- [ ] **步骤 4.2：删 jose 依赖**

```bash
npm uninstall jose
```

确认 package.json dependencies 无 jose、node_modules 解析不再包含。

- [ ] **步骤 4.3：tests/session.test.ts 适配**

- 通道分派用例：`vi.mock("jose")` 相关（若有）删除；`vi.stubGlobal("fetch", ...)` mock JWKS 端点响应 `{ keys: [] }` → 断言 reason=verify-failed、input 含 via=jwks（fetch 失败/空 keys 均被包捕获为 ok:false）。SignJWT 仍来自 jose（**保留 jose 为 devDependencies 仅测试用**——或改用 tests/helpers/sign-jwt 的 WebCrypto 签名器，二选一以 helper 为准）。
- 其余用例不变。

- [ ] **步骤 4.4：运行测试 + 三门禁**

运行：`npm test`、`npm run lint`、`npm run build`
预期：全绿；`grep jose package.json` 零命中（dependencies 层面）。

- [ ] **步骤 4.5：Commit**

```bash
git add app/lib/session.ts package.json package-lock.json tests/session.test.ts
git commit -m "refactor(ssr): route the JWKS verification channel through @lucky/auth-core and drop jose"
```

---

### 任务 5：全量验证与收尾

**文件：**
- 修改：`AGENTS.md`（§0.1 包描述补验签核心；§3 铁则 6 表述确认）
- 修改：`skills/clerk-edge-auth/SKILL.md`（§1.1/§3-§5 更新为包化事实）

- [ ] **步骤 5.1：契约文档同步**

- AGENTS.md §0.1：shared/auth-core 描述追加“含八步验签核心（RS256 BigInt + ES256 + JWKS 缓存）——三层验签单一真源”
- clerk-edge-auth SKILL.md §1.1：SSR 通道 2 说明改指包内 verifySessionDetailed；§3-§5 注明“实现已收敛至 @lucky/auth-core，本节保留清单语义与诊断契约”
- 检查 grep：`sync-shared.cjs`、`jose` 在 app/functions/agents 源码零引用

- [ ] **步骤 5.2：三门禁 + 生产模式冒烟**

运行：`npm test`（预期 ≥274 passed，用例数因去重±波动）、`npm run lint`、`npm run build`（含 Proxy）；
`npx next start -p 3100` 后 curl `/zh/admin/`、`/zh/`、`/en/tools/` 全 200。

- [ ] **步骤 5.3：Commit + Push**

```bash
git add AGENTS.md skills/clerk-edge-auth/SKILL.md
git commit -m "docs: record the unified verifier architecture in contracts"
git push
```

---

## 自检记录

- 规格覆盖度：4.1 包结构→任务 1；4.2 接口→任务 1（步骤 1.3）；4.3 provider→计划未单列任务——**修正**：provider（clerkProvider/apexFromIssuer）并入任务 1 步骤 1.3 的 verify.js/predicates.js 导出（clerkProvider 置 predicates.js，apexFromIssuer 3 行实现），auth-core.test.ts 增 1 用例（clerkProvider.apexFromIssuer("https://clerk.rdom.cn") === "rdom.cn"）；4.4→任务 2/3；4.5→任务 4；4.6→任务 1/4 的 detail 断言；§5 测试→任务 1 步骤 1.6 + 各任务去重步骤；§6 顺序→任务 1-5。
- 占位符扫描：任务 1 步骤 1.5 的 helper 函数名以“code-run.test.ts 现状为准”标注——这是移植型步骤的精确指令（来源即真源），非占位符。
- 类型一致性：verifySessionDetailed 的 deps 字段名与 todo.js/agents 现有注入字段逐一相同；session.ts 的 SessionResult/rbac 契约未变。
