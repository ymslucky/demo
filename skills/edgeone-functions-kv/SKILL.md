---
name: "edgeone-functions-kv"
description: "EdgeOne Pages 边缘函数与 KV 存储知识：部署模型、Web 标准运行时约束、KV 语义、presence/counter 存储模型、缓存规则。凡涉及 functions/、KV、/api 端点或 edgeone.json 时调用。"
---

# EdgeOne 边缘函数与 KV 存储

## 1. 部署模型与路由优先级

[edgeone.json](../../edgeone.json) 为 Next.js SSR 适配器设置
`buildCommand`/`outputDirectory`（`.next`）；[functions/](../../functions/) 随应用
一同部署。在 EdgeOne Pages 上，请求**先匹配边缘函数路由**，再回落到 Next.js
服务器——所以 `/api/presence` 等由边缘函数服务，页面路由走 `proxy.ts` 与
SSR/预渲染。

## 2. 运行时约束（边缘 JS 运行时，不是 Node）

- 只能用 Web 标准 API：`fetch`、`Request`/`Response`、`URL`、`crypto`（RSA 有
  缺口，见 clerk-edge-auth skill）。没有 Node 内置模块、没有文件系统、没有
  `/tmp` 持久化。
- `onRequest*` 处理器保持薄；纯逻辑导出给
  [tests/functions.test.ts](../../tests/functions.test.ts)。修改导出签名必须在
  同一提交中更新该测试。
- 每个函数文件保持**自包含**——函数之间禁止互相 import。引入共享模块属于设计
  决策，不是重构。
- **没有** `functions/index.js`：根路径的 locale 协商在 `proxy.ts` 里。绝不要
  重新添加 `/` 边缘函数——它会遮蔽 Next.js 层。

## 3. 函数清单

- [functions/api/presence.js](../../functions/api/presence.js) → 实时在线人数。
  POST = 心跳 + 惰性清扫，GET = 只读快照。
- [functions/api/counter.js](../../functions/api/counter.js) → 仅登录可用的计数器。
  每用户键 `counter_user_<uid>`；GET = 只读快照 `{ total, users, mine }`，
  POST = 验证 Clerk 会话 → 读-改-写 +1。两个动词对未认证调用一律 401
  （验签见 clerk-edge-auth skill）。
- [functions/api/echo.js](../../functions/api/echo.js) ·
  [functions/api/headers.js](../../functions/api/headers.js) → http-check 调试
  端点（永不缓存）。

## 4. KV 最佳实践（官方语义）

命名空间在 EdgeOne 控制台绑定，变量名 `DICTIONARY`；它以**裸的边缘函数全局
标识符**注入，不在 `context.env` 上——`getKv()` 通过带 `typeof` 守卫的裸标识符
读取，附带 `globalThis` 兜底。

- **键**只接受 `[A-Za-z0-9_]`（≤512B）——所有用户来源的输入必须规范化（见
  `sessionKey()` / `counterKey()`）。值为字符串，≤25MB。
- **无 TTL、无原子 INCR**：过期由应用层决定（presence：45 秒心跳窗口）；计数靠
  `list({ prefix })` + 逐键 `get` 计算（`countOnline` / `countTotals`）——天然近似。
- **最终一致（约 60 秒全局传播）**：总数都是近似值；UI 文案不得承诺精确。
- **`list()`** 是唯一的键发现 API，每页最多 256 个键（更多用 `cursor` 翻页）。
  `keys` 数组的每项是 `ListKey` 对象，字段名是 **`key`**
  （`class ListKey { key: String }`——不是 `name`）。列出后用 `Promise.all`
  批量读取，不要逐键串行 await。
- **没有后台任务**：过期键的删除搭载在写路径请求上（惰性清扫）。
- **KV 只能从边缘函数调用。** 未绑定或不可用时优雅降级：presence 与 counter
  应答 `503 {error:"kv-not-configured"}` / `{error:"kv-unavailable"}`；counter
  UI 保留上次读数/提供重试，而不是崩溃。

## 5. 缓存规则

- 所有 API/函数响应一律 `cache-control: no-store`。
- **禁止 HTML 边缘缓存**：页面含认证状态 UI，按路由的 `s-maxage` 头与无前缀
  `redirects` 已从 [edgeone.json](../../edgeone.json) 移除——**不要重新加回**
  （跨用户缓存泄漏）。仅存两条头：`/_next/static/*` → immutable、
  `/feed.xml` → `s-maxage=3600`。
- 博客点赞/表情功能是**有意删除**的——不要复活 `/api/reactions`、
  `reaction-store` 或 `PostReactions`。
