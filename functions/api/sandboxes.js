/**
 * Code Sandbox 实例列表（EdgeOne 边缘函数 + KV 存储）— 仅登录用户可用。
 *
 * 存储模型（EdgeOne Pages KV，官方文档语义）：
 * - KV 命名空间在控制台以变量名 SANDBOX 绑定，注入为边缘函数全局变量
 *   （不在 context.env / process.env 上，见 getKv 的 typeof 守卫）；
 * - 每个沙箱实例一个 key：sb_<归一化 instanceId>（实例 ID 可能含 UUID
 *   连字符，须归一化到 KV 合法字符集 [A-Za-z0-9_]），值为实例档案 JSON：
 *   { uid, instanceId, createdAt, updatedAt, expiresAt, externalUrl }；
 * - uid 只取自服务端会话验签（payload.sub），绝不信任请求体；
 * - 写入口径：前端在 run / extend / 刷新信息成功后 POST upsert（心跳式
 *   刷新 updatedAt 与到期时间），重置沙箱后 DELETE 释放记录；
 * - KV 无 TTL：历史记录保留 30 天（RETENTION_MS）——已到期档案仍返回
 *   （前端标记状态），仅"过期且超龄"与畸形记录在 GET 列表时惰性清除
 *   （搭载在请求路径上的 sweep）；KV 为最终一致（约 60s 全球同步），
 *   列表是尽力而为的近实时视图。
 *
 * 登录验证（Clerk 会话，对齐官方手动验签清单）：验签核心由 npm 包
 * @lucky/auth-core 提供（与 functions/api/todo.js 共用同一单一真源）——
 * __session cookie 中的会话 JWT 按 header.alg 分派验签，RS256 走纯 JS
 * BigInt 实现（边缘运行时 crypto.subtle 不支持 RSA，见 verifyRs256），
 * issuer 白名单 / azp 判定基准由 SITE_DOMAIN 派生，默认 rdom.cn。
 *
 * 错误语义：401 unauthorized（附 x-auth-fail 诊断头）、400 invalid-json /
 * invalid-instance、403 forbidden / not-found、503 kv-not-configured /
 * kv-unavailable。
 *
 * 部署路径：/api/sandboxes（functions/api/sandboxes.js）
 */

import { DEFAULT_SITE_APEX, siteApex, verifySessionDetailed } from "@lucky/auth-core";

// 共享判定与验签核心 re-export（单一真源 @lucky/auth-core，供测试与上层复用）。
export {
  isAllowedAzp,
  isTokenFresh,
  parseTokenPayload,
  siteApex,
  verifyRs256,
  verifySessionToken,
} from "@lucky/auth-core";

const KEY_PREFIX = "sb_";
const MAX_INSTANCE_ID_LEN = 128;
const MAX_URL_LEN = 500;
// KV list 单页最多 256 键，翻页取全。
const LIST_PAGE_SIZE = 256;
// 历史记录保留期：已到期（且到期超过保留期）的档案才被惰性清扫，期间
// GET 列表仍返回它们（前端按状态标记"已到期"），满足"保留一月内记录"。
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// 会话 JWT 的 issuer 白名单与 azp 判定基准，全部由站点访问域名派生
// （钉死 issuer 是 Clerk 官方手动验签清单的硬性要求，详见 todo.js 同段注释）。
const SITE_APEX = siteApex(globalThis.process?.env?.SITE_DOMAIN) ?? DEFAULT_SITE_APEX;
const ALLOWED_ISSUERS = [`https://clerk.${SITE_APEX}`];

/** instanceId 归一化为合法 KV key（仅数字/字母/下划线，最长 128）。导出仅供测试。 */
export function sandboxKey(instanceId) {
  return KEY_PREFIX + String(instanceId).replace(/[^A-Za-z0-9_]/g, "_").slice(0, 128);
}

function getKv() {
  // 绑定命名空间按控制台设置的变量名（SANDBOX）注入为边缘函数全局变量，
  // 而非 context.env 属性。typeof 守卫：未绑定时不抛 ReferenceError，
  // 返回 null 以便上层优雅降级为 503。
  if (typeof SANDBOX === "undefined") return null;
  return SANDBOX;
}

function jsonResponse(body, extraHeaders = {}, status = 200) {
  // V8 运行时没有 Response.json 静态方法，须手工序列化。
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

// ---------------------------------------------------------------------------
// 实例档案纯逻辑（导出仅供测试；处理器直接组合它们）
// ---------------------------------------------------------------------------

/**
 * 把 KV 原始值（JSON 字符串或已解析值）守卫式归一化为实例档案；缺
 * instanceId/uid 或任何畸形输入返回 null。导出仅供测试。
 */
export function normalizeSandboxRecord(value) {
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof raw !== "object" || raw === null) return null;
  const instanceId = typeof raw.instanceId === "string" ? raw.instanceId.trim() : "";
  const uid = typeof raw.uid === "string" ? raw.uid.trim() : "";
  if (!instanceId || !uid) return null;
  const createdAt = Number(raw.createdAt);
  const updatedAt = Number(raw.updatedAt);
  return {
    uid,
    instanceId,
    createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : 0,
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : 0,
    expiresAt: typeof raw.expiresAt === "string" && raw.expiresAt ? raw.expiresAt : undefined,
    externalUrl:
      typeof raw.externalUrl === "string" && raw.externalUrl
        ? raw.externalUrl.slice(0, MAX_URL_LEN)
        : undefined,
  };
}

/**
 * 上报/更新一条实例档案（last-write-wins）：不存在则创建（createdAt =
 * now），存在则原位更新（保留 createdAt，刷新 updatedAt / 到期时间 /
 * 外部地址）。档案已被其他用户占用（instanceId 撞车）时返回 null，由
 * 处理器转 403。导出仅供测试。
 */
export async function upsertSandbox(kv, uid, payload, now = Date.now()) {
  const key = sandboxKey(payload.instanceId);
  const existing = normalizeSandboxRecord(await kv.get(key));
  if (existing && existing.uid !== uid) return null;
  const record = {
    uid,
    instanceId: payload.instanceId,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    expiresAt: payload.expiresAt ?? existing?.expiresAt,
    externalUrl: payload.externalUrl ?? existing?.externalUrl,
  };
  await kv.put(key, JSON.stringify(record));
  return record;
}

/**
 * 释放（删除）一条实例档案：仅所属用户可删；档案不存在或非本人返回
 * false（处理器转 404）。导出仅供测试。
 */
export async function releaseSandbox(kv, uid, instanceId) {
  const key = sandboxKey(instanceId);
  const existing = normalizeSandboxRecord(await kv.get(key));
  if (!existing || existing.uid !== uid) return false;
  await kv.delete(key);
  return true;
}

/**
 * 列出全部实例档案：list（前缀翻页取全）→ Promise.all 批量 get → 守卫
 * 归一化。历史记录保留策略：已到期的档案仍返回（前端标记"已到期"），
 * 仅"过期且超龄"（到期基准超过 RETENTION_MS）或畸形档案进 stale，sweep
 * 时把对应 key 一并惰性删除。超龄基准取 max(到期时间, 最近更新)——
 * 缺 expiresAt 的畸形时间戳以 updatedAt 兜底。结果按 updatedAt 倒序。
 * 导出仅供测试。
 */
export async function listSandboxes(kv, { now = Date.now(), sweep = false } = {}) {
  const names = [];
  let cursor = "";
  do {
    const page = await kv.list({ prefix: KEY_PREFIX, limit: LIST_PAGE_SIZE, cursor });
    const keys = (Array.isArray(page?.keys) ? page.keys : [])
      .map((entry) => (typeof entry === "string" ? entry : entry?.key))
      .filter((name) => typeof name === "string" && name.startsWith(KEY_PREFIX));
    names.push(...keys);
    cursor = typeof page?.cursor === "string" ? page.cursor : "";
  } while (cursor);

  const raws = await Promise.all(names.map((name) => kv.get(name)));
  const stale = [];
  const records = [];
  names.forEach((name, index) => {
    const record = normalizeSandboxRecord(raws[index]);
    if (!record) {
      stale.push(name);
      return;
    }
    const expiry = record.expiresAt ? Date.parse(record.expiresAt) : NaN;
    const retireAt = Number.isFinite(expiry) ? expiry : record.updatedAt;
    if (retireAt > 0 && retireAt <= now - RETENTION_MS) {
      stale.push(name);
      return;
    }
    records.push(record);
  });
  if (sweep && stale.length) {
    await Promise.all(stale.map((name) => kv.delete(name)));
  }
  records.sort((a, b) => b.updatedAt - a.updatedAt);
  return records;
}

// ---------------------------------------------------------------------------
// Clerk 会话验证（八步验签清单的单一真源是 npm 包 @lucky/auth-core，与
// todo.js 共用；此处只保留本站默认派生的薄包装。RS256 绝不走 Web Crypto）
// ---------------------------------------------------------------------------

/** 从请求 Cookie 中提取 Clerk 会话 JWT（__session）。导出仅供测试。 */
export function readSessionToken(request) {
  const cookie = request?.headers?.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)__session=([^;]*)/);
  return match ? match[1].trim() : null;
}

/**
 * 验证 Clerk 会话 JWT（详细版）：成功 { ok: true, payload }，失败
 * { ok: false, reason }（reason 进 401 的 x-auth-fail 诊断头）。八步
 * 清单由 @lucky/auth-core 的 verifySessionDetailed 提供（单一真源，
 * 依赖注入语义同 todo.js 的 verifyTokenDetailed）；本包装只注入本站
 * 默认派生（issuer 白名单 / azp apex，见模块顶部常量）。导出仅供测试。
 */
export async function verifyTokenDetailed(
  token,
  {
    jwks = null,
    now = Date.now(),
    crypto: cryptoObj = globalThis.crypto,
    fetchJwks,
    allowedIssuers = ALLOWED_ISSUERS,
    azpApex = SITE_APEX,
  } = {},
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

/**
 * 会话验证 + uid 提取：成功 { uid, reason: null }；失败
 * { uid: null, reason }，reason 进 401 响应的 x-auth-fail 诊断头。
 */
async function readSessionUid(request) {
  const token = readSessionToken(request);
  if (!token) return { uid: null, reason: "no-cookie" };
  const result = await verifyTokenDetailed(token);
  if (!result.ok) return { uid: null, reason: result.reason };
  const sub = result.payload?.sub;
  return typeof sub === "string" && sub.length > 0
    ? { uid: sub, reason: null }
    : { uid: null, reason: "sub" };
}

/** 解析 JSON body（畸形 / 非对象一律 null）。 */
async function readJsonBody(request) {
  try {
    const body = await request.json();
    return typeof body === "object" && body !== null ? body : null;
  } catch {
    return null;
  }
}

/** body 中的 instanceId 守卫：非空字符串、trim 后截断到长度上限。 */
function cleanInstanceId(value) {
  return typeof value === "string" ? value.trim().slice(0, MAX_INSTANCE_ID_LEN) : "";
}

/** body 中可选字符串字段守卫（undefined 表示"不更新该字段"）。 */
function cleanOptionalText(value, maxLen) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLen) : undefined;
}

/**
 * GET：登录后返回 30 天保留期内的全部实例档案（含所属用户），已到期
 * 记录保留（前端标记状态），仅超龄与畸形记录惰性清除。响应体
 * { sandboxes: [...] }，按最近更新倒序。
 */
export async function onRequestGet({ request }) {
  const kv = getKv();
  if (!kv) return jsonResponse({ error: "kv-not-configured" }, { "x-kv": "unbound" }, 503);
  try {
    const { uid, reason } = await readSessionUid(request);
    if (!uid) {
      return jsonResponse({ error: "unauthorized" }, { "x-auth-fail": reason }, 401);
    }
    return jsonResponse({ sandboxes: await listSandboxes(kv, { now: Date.now(), sweep: true }) });
  } catch {
    return jsonResponse({ error: "kv-unavailable" }, {}, 503);
  }
}

/**
 * POST：登录后上报自己创建的实例档案（run / extend / 刷新信息成功后的
 * 心跳式 upsert，uid 取自会话验签）。instanceId 撞车到他人档案回 403。
 */
export async function onRequestPost({ request }) {
  const kv = getKv();
  if (!kv) return jsonResponse({ error: "kv-not-configured" }, { "x-kv": "unbound" }, 503);
  try {
    const { uid, reason } = await readSessionUid(request);
    if (!uid) {
      return jsonResponse({ error: "unauthorized" }, { "x-auth-fail": reason }, 401);
    }
    const body = await readJsonBody(request);
    const instanceId = cleanInstanceId(body?.instanceId);
    if (!instanceId) return jsonResponse({ error: "invalid-instance" }, {}, 400);
    const record = await upsertSandbox(kv, uid, {
      instanceId,
      expiresAt: cleanOptionalText(body?.expiresAt, 64),
      externalUrl: cleanOptionalText(body?.externalUrl, MAX_URL_LEN),
    });
    if (!record) return jsonResponse({ error: "forbidden" }, {}, 403);
    return jsonResponse({ sandbox: record }, {}, 201);
  } catch {
    return jsonResponse({ error: "kv-unavailable" }, {}, 503);
  }
}

/** DELETE：登录后释放自己的实例档案（?instance= 优先，回落 body { instanceId }）。 */
export async function onRequestDelete({ request }) {
  const kv = getKv();
  if (!kv) return jsonResponse({ error: "kv-not-configured" }, { "x-kv": "unbound" }, 503);
  try {
    const { uid, reason } = await readSessionUid(request);
    if (!uid) {
      return jsonResponse({ error: "unauthorized" }, { "x-auth-fail": reason }, 401);
    }
    let instanceId = null;
    try {
      instanceId = new URL(request.url).searchParams.get("instance");
    } catch {
      instanceId = null;
    }
    if (!instanceId) {
      const body = await readJsonBody(request);
      if (typeof body?.instanceId === "string" && body.instanceId) instanceId = body.instanceId;
    }
    instanceId = cleanInstanceId(instanceId);
    if (!instanceId) return jsonResponse({ error: "invalid-instance" }, {}, 400);
    const released = await releaseSandbox(kv, uid, instanceId);
    if (!released) return jsonResponse({ error: "not-found" }, {}, 404);
    return jsonResponse({ ok: true });
  } catch {
    return jsonResponse({ error: "kv-unavailable" }, {}, 503);
  }
}
