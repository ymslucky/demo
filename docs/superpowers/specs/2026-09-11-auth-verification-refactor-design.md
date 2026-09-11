# 身份验证模块重构设计（2026-09-11）

状态：已获用户批准的设计（方案一 + provider 适配层补充）。

## 1. 背景与问题

身份验证判定逻辑存在于四个文件、四种实现栈，已发生实际漂移：

| 位置 | 实现 | 问题 |
|---|---|---|
| functions/api/todo.js | 八步手写验签（RS256 BigInt + ES256 subtle + JWKS 缓存） | 源头实现，生产验证 |
| functions/api/sandboxes.js | todo.js 的逐字复制 | 漂移：issuer 派生仍是旧字面量，不支持 CLERK_ISSUER |
| agents/code-run/index.ts | TS 移植版 | 独立维护 |
| app/lib/session.ts | jose JWKS 通道 + verifyToken PEM/SK 通道 | 诊断为自由文本，非逐关码 |

次要问题：验签测试三套重复；环境变量（SITE_DOMAIN / CLERK_ISSUER / CLERK_AZP_ORIGINS /
CLERK_SECRET_KEY / CLERK_JWT_PUBLIC_KEY）分散无登记；`@lucky/auth-core` 仅覆盖纯判定。

## 2. 目标与非目标

**目标**：验签实现四份合一份（@lucky/auth-core 承载八步验签核心）；SSR 诊断升级为逐关码；
删除 jose 依赖；测试收敛为一份验签矩阵；provider 适配层隔离供应商特有参数。

**非目标**：不改 KV 业务逻辑；不改 admin UI 门控契约（SessionResult/rbac API 保持）；
不实现第二个 provider 的具体后端（如 Supabase）——只写契约与示例注释；不改构建流程。

## 3. 方案对比（已决策：方案一）

- **方案一（选定）**：验签核心完整抽入 @lucky/auth-core；边缘/agents 直接 import；SSR 的
  JWKS 通道改调包内实现，PEM/SK 通道保留 `verifyToken`（生产出网现实所需）。
- 方案二（否决）：SSR 全量换手写——放弃刚修复的生产链路上的官方库路径，风险收益比差。
- 方案三（否决）：只修漂移不合并——四份实现永久存在，与复用诉求相悖。

## 4. 设计

### 4.1 包结构

```
shared/auth-core/
├── package.json      （不变：name @lucky/auth-core, type module, main index.js）
└── index.js          ← 出口聚合：export * from "./predicates.js" 等三模块
    predicates.js     ← 现有纯判定（siteApex/normalizeIssuer/parseList/deriveIssuers/
                         isAllowedAzp/roleFromClaims/DEFAULT_SITE_APEX/ADMIN_ROLE）
    keys.js           ← JWKS 获取与缓存（TTL 1h + kid 未命中强制刷新）+ base64url/token 解析
    verify.js         ← verifySessionDetailed（八步逐关）+ verifyRs256 + verifyEs256
```

包约束：零 npm 依赖、零 env 读取（env 派生由调用方传入）、Node 22 与 EdgeOne 边缘运行时
同构（全局 fetch / crypto.subtle.digest；RS256 用纯 JS BigInt——边缘 subtle 缺 RSA）。

### 4.2 核心接口

```js
verifySessionDetailed(token, {
  jwks,            // 直接注入 keys（测试）；跳过网络
  now,             // 时间注入（默认 Date.now()）
  crypto,          // 默认 globalThis.crypto
  fetchJwks,       // (issuer, { forceRefresh }) => keys；默认 keys.js 内置实现
  allowedIssuers,  // 白名单数组（调用方派生）
  azpApex,         // azp host 判定基准
}) → { ok: true, payload } | { ok: false, reason }
```

- reason 枚举（= x-auth-fail）：`parse / alg:<x> / iss / azp / nbf / exp / sts / kid / sig / crypto`
- 签名与注入字段名沿用 todo.js 生产验证过的 `verifyTokenDetailed`——包装层近零适配
- 八步：parse → alg 分派（ES256/RS256）→ iss 白名单 → azp（缺失放行）→ nbf/exp（5s 容差）
  → sts（非 active 拒绝）→ kid 选取（未命中强制刷新一次）→ 验签

### 4.3 provider 适配层（换验证体系的预留，按用户要求）

新增 `providers.js`：把供应商特有参数收敛为配置对象契约。

```js
export const clerkProvider = {
  id: "clerk",
  // issuer 白名单派生（clerk.<apex> 惯例 + 显式覆盖）
  issuers: ({ siteDomain, issuerOverride }) => deriveIssuers({ siteDomain, clerkIssuer: issuerOverride }),
  // claims → 标准化角色
  roleFromClaims,           // payload.metadata.role（现 shared 实现）
  // azp 判定基准派生：iss host → apex
  apexFromIssuer: (iss) => siteApex(iss) 去除 "clerk." 前缀,
};
```

- 换体系（如 Supabase Auth）= 新增一个 provider 对象实现同契约（issuers / roleFromClaims /
  apexFromIssuer），调用方换一行 import——**验证核心（verifySession）与门控层零改动**。
- 本期只实现 `clerkProvider`；契约注释中给出 Supabase 形态示例（不写实现，避免无法验证的死代码）。
- verifySession 本体不感知 provider（只吃 issuers/azpApex 参数）——算法与供应商解耦。

### 4.4 四层接入

| 层 | 移除 | 变为 |
|---|---|---|
| todo.js | ~280 行验签段 | import 包 + 薄包装（`verifyTokenDetailed`/`verifySessionToken` 导出名与注入签名不变；模块级派生 ALLOWED_ISSUERS/azpApex 留在文件内——env 属于部署层）+ `export { isAllowedAzp, siteApex }` re-export 保持测试导入面 |
| sandboxes.js | 同样的复制段 | 同 todo.js（修复 B2 漂移，获得 CLERK_ISSUER 支持） |
| code-run/index.ts | TS 移植版验签 | `verifyAgentSession` 薄包装（内部调包；readCookieToken 等运行时差异留在 agents）+ re-export |
| session.ts | jose JWKS 通道 | JWKS 通道调包内 verifySessionDetailed；PEM/SK 通道保留 verifyToken |

### 4.5 SSR 通道重排

```
通道链：PEM（verifyToken jwtKey）→ JWKS（包内 verifySessionDetailed）→ SK 回源（verifyToken）
reason 映射：包 reason → SessionResult.detail（逐关码）；reason 四值契约不变
删除：jose 依赖、包外 JWKS 缓存
```

### 4.6 诊断契约（不变）

SessionResult = { claims, reason: no-cookie|no-key|verify-failed|issuer-mismatch, detail, input }；
门控卡四态与 metadata 快照行保持；`@lucky/auth-core` 的 detail 升级为逐关码。

## 5. 测试策略

- 新增 `tests/auth-core.test.ts`：ES256/RS256 真签名矩阵、九类逐关 reason、kid 强制刷新
  （fetch 注入计数断言）、JWKS TTL 过期重取、azp 点边界（ evil.com/notrdom.cn 拒绝）、
  sts 拒绝、clock skew 容差——一份测试覆盖三层。
- functions.test.ts / code-run.test.ts：保留（包装层与业务集成），删除与包重复的纯算法用例。
- session.test.ts：通道分派保留；jose mock 改 fetch mock（包走全局 fetch）。
- 门禁：274+ 用例全绿 / lint / build 含 Proxy；生产模式 next start 冒烟。

## 6. 迁移顺序（每步独立提交、可回退）

1. auth-core 增三模块验签核心 + provider + 新包测试（纯新增）
2. todo.js / sandboxes.js 切换包装 → functions.test 全绿
3. code-run 切换 → code-run.test 全绿
4. session.ts JWKS 通道切换 + 删 jose → session.test 全绿
5. 三门禁 + next start 冒烟 + 推送

## 7. 换验证体系指南（未来）

1. 新增 provider 对象（issuers / roleFromClaims / apexFromIssuer 三方法契约见 4.3）
2. 调用方换 provider import 与对应环境变量
3. verifySession 算法核心与门控层（rbac/page/actions）零改动
4. 登录侧（ClerkProvider → 新体系 SDK）与 middleware 属登录体系替换，独立于本设计
