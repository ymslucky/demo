/**
 * 实时在线人数（EdgeOne 边缘函数 + KV 存储）— 按官方最佳实践实现。
 *
 * 存储模型（EdgeOne Pages KV，官方文档语义）：
 * - 每个会话一个 key：presence_<归一化 sessionId>，值为最近心跳的
 *   毫秒时间戳（KV 的 put 无 TTL，因此过期在应用层判定）；
 * - KV 仅支持数字/字母/下划线作 key，sessionId 做归一化清洗；
 * - KV 无原子 INCR，计数通过 list({prefix}) + 逐 key 读取时间戳、
 *   过滤掉超过 45s 未心跳的会话得出；
 * - list 是 KV 中删除过期 key 的唯一途径 —— POST 心跳时顺带惰性
 *   删除已过期会话（sweep），避免陈旧 key 无限累积；
 * - KV 为最终一致（约 60s 全球同步），计数是近似值而非精确快照。
 *
 * KV 命名空间须在控制台绑定到项目，变量名为 luckylab_kv；未绑定或
 * KV 不可用时返回 503，前端保持上一次读数不崩溃。
 *
 * 部署路径：/api/presence（functions/api/presence.js）
 */

const SESSION_TTL_MS = 45_000;
const LIST_PAGE_SIZE = 200;
const KEY_PREFIX = "presence_";
const KV_BINDING = "luckylab_kv";

/** sessionId 归一化为合法 KV key（仅数字/字母/下划线，最长 64）。导出仅供测试。 */
export function sessionKey(sessionId) {
  return KEY_PREFIX + String(sessionId).replace(/[^A-Za-z0-9_]/g, "_").slice(0, 64);
}

function getKv(env) {
  // 绑定命名空间既可能以 context.env 属性暴露，也可能按官方示例注入
  // 为全局变量 —— 两种路径都探测，未绑定返回 null。
  return env?.[KV_BINDING] ?? globalThis?.[KV_BINDING] ?? null;
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

/**
 * 统计活跃会话数：列出全部 presence_* key，逐个读取时间戳，
 * 超过 TTL 的视为离线；sweep 为 true 时顺带删除过期 key。
 * 导出仅供测试。
 */
export async function countOnline(kv, { now = Date.now(), sweep = false } = {}) {
  const result = await kv.list({ prefix: KEY_PREFIX, limit: LIST_PAGE_SIZE });
  const entries = Array.isArray(result?.keys) ? result.keys : [];

  let online = 0;
  for (const entry of entries) {
    // ListKey 的字段名为 key（官方 ListResult 定义）。
    const name = typeof entry === "string" ? entry : entry?.key;
    if (typeof name !== "string") continue;

    const raw = await kv.get(name);
    const ts = Number(raw);
    if (!Number.isFinite(ts) || now - ts > SESSION_TTL_MS) {
      if (sweep) await kv.delete(name);
      continue;
    }
    online += 1;
  }
  return online;
}

async function heartbeat(request, env, sweep) {
  const kv = getKv(env);
  if (!kv) return jsonResponse({ error: "kv-not-configured" }, { "x-kv": "unbound" }, 503);

  let sessionId;
  try {
    const body = await request.json();
    sessionId = body?.sessionId;
  } catch {
    return jsonResponse({ error: "invalid-json" }, {}, 400);
  }
  if (typeof sessionId !== "string" || sessionId.length === 0 || sessionId.length > 64) {
    return jsonResponse({ error: "invalid-session" }, {}, 400);
  }

  const now = Date.now();
  await kv.put(sessionKey(sessionId), String(now));
  const online = await countOnline(kv, { now, sweep });
  return jsonResponse({ online });
}

/** POST：记录心跳并顺带惰性清理过期会话，返回当前在线数。 */
export async function onRequestPost({ request, env }) {
  try {
    return await heartbeat(request, env, true);
  } catch {
    return jsonResponse({ error: "kv-unavailable" }, {}, 503);
  }
}

/** GET：只读快照，不做任何写入。 */
export async function onRequestGet({ env }) {
  const kv = getKv(env);
  if (!kv) return jsonResponse({ error: "kv-not-configured" }, { "x-kv": "unbound" }, 503);
  try {
    const online = await countOnline(kv, { now: Date.now(), sweep: false });
    return jsonResponse({ online });
  } catch {
    return jsonResponse({ error: "kv-unavailable" }, {}, 503);
  }
}
