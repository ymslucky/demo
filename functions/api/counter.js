/**
 * 实时计数器（EdgeOne 边缘函数 + KV 存储）— 仅登录用户可用。
 *
 * 存储模型（EdgeOne Pages KV，官方文档语义）：
 * - 每个登录用户一个 key：counter_user_<归一化 userId>，值为该用户
 *   累计点击次数（字符串数字）；全局总数 = 全部 key 求和；
 * - KV key 仅允许数字/字母/下划线，userId（Clerk sub）做归一化清洗；
 * - KV 无原子 INCR，"+1" 通过 get → +1 → put 的读改写实现；
 * - KV 为最终一致（约 60s 全球同步），总数是近似值而非精确快照。
 *
 * 登录验证（Clerk 会话，边缘运行时 Web Crypto，对齐官方手动验签清单）：
 * - 读取 __session cookie 中的 Clerk 会话 JWT，按 header.alg 分派验签：
 *   ES256 = ECDSA P-256 + SHA-256；RS256 = RSASSA-PKCS1-v1_5 + SHA-256
 *   （生产实例 JWKS 实测密钥型为 RSA/RS256）；其余算法直接拒绝；
 * - 钉死 issuer：payload.iss 必须命中 ALLOWED_ISSUERS 白名单，JWKS 只从
 *   白名单实例回源——绝不信任 token 内任意 iss（否则攻击者可自造 JWKS
 *   伪造任意身份，构成认证绕过）；
 * - 校验 azp：存在且不在 ALLOWED_AZP 白名单时拒绝（Clerk 官方建议，
 *   防子域 cookie 泄漏攻击；旧实例可能不带 azp，缺失时放行）；
 * - exp/nbf 均带 CLOCK_SKEW_S（5s）容差（对齐 Clerk SDK clockSkewInMs
 *   默认值）；sts 存在且非 "active" 时拒绝；
 * - JWKS 按 <iss>/.well-known/jwks.json 回源（模块级缓存 1h），按
 *   header.kid 选取公钥；kid 未命中时强制刷新 JWKS 重试一次（自愈密钥
 *   轮换与陈旧缓存），仍无则拒绝；
 * - crypto.subtle.importKey("jwk", …) + verify 验签；验证通过即视为登录，
 *   uid 取 payload.sub。
 *
 * 错误语义：401 unauthorized（未登录/会话过期/验签失败，响应附
 * x-auth-fail 诊断头说明失败环节）、400 invalid-json、
 * 503 kv-not-configured / kv-unavailable。
 *
 * 部署路径：/api/counter（functions/api/counter.js）
 */

const KEY_PREFIX = "counter_user_";
const LIST_PAGE_SIZE = 200;
const KV_BINDING = "DICTIONARY";
const JWKS_TTL_MS = 3_600_000;
// 会话 JWT 的 issuer / azp（来源 origin）白名单：本站生产 Clerk 实例。
// 钉死 issuer 是 Clerk 官方手动验签清单的硬性要求（防"任意 iss + 自造
// JWKS"伪造身份）；azp 校验防子域 cookie 泄漏攻击。旧实例可能不带
// azp——按官方示例，缺失时放行，存在且不匹配才拒绝。
const ALLOWED_ISSUERS = ["https://clerk.rdom.cn"];
const ALLOWED_AZP = ["https://rdom.cn"];
// Clerk SDK 默认 clockSkewInMs = 5000：exp/nbf 判断保持同样的容差，
// 避免边缘节点与签发方时钟的毫秒级偏移误伤刚签发的会话。
const CLOCK_SKEW_S = 5;

/** userId 归一化为合法 KV key（仅数字/字母/下划线，最长 64）。导出仅供测试。 */
export function counterKey(uid) {
  return KEY_PREFIX + String(uid).replace(/[^A-Za-z0-9_]/g, "_").slice(0, 64);
}

function getKv() {
  // 官方语义（同官方模板的裸标识符用法）：绑定命名空间按控制台设置的
  // 变量名（DICTIONARY）注入为全局变量，而非 context.env 属性。
  // 裸标识符配 typeof 守卫（未绑定时 typeof 不抛 ReferenceError），
  // 再退回 globalThis 属性探测；两者皆无视为未绑定，返回 null。
  if (typeof DICTIONARY !== "undefined") return DICTIONARY;
  return globalThis?.[KV_BINDING] ?? null;
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
 * 汇总一批计数值：只累计非负有限数字，users 为有效参与人数。
 * 导出仅供测试。
 */
export function sumCounts(raws) {
  let total = 0;
  let users = 0;
  for (const raw of raws ?? []) {
    // null/undefined 表示键无值（KV 列表与读取间的最终一致间隙），
    // 不计入参与人数；Number(null) === 0 的陷阱在此排除。
    if (raw === null || raw === undefined) continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) {
      total += n;
      users += 1;
    }
  }
  return { total, users };
}

/**
 * 读改写实现一次 "+1"：读取该用户当前计数（缺失/损坏按 0 起步），
 * 写回 +1 后的新值并返回。导出仅供测试。
 */
export async function applyTap(kv, uid) {
  const key = counterKey(uid);
  const current = Number(await kv.get(key));
  const mine = Number.isFinite(current) && current >= 0 ? current + 1 : 1;
  await kv.put(key, String(mine));
  return mine;
}

/**
 * 列出全部 counter_user_* key 并逐个读取，返回全局快照
 * { total, users }。导出仅供测试。
 */
export async function countTotals(kv) {
  const result = await kv.list({ prefix: KEY_PREFIX, limit: LIST_PAGE_SIZE });
  const entries = Array.isArray(result?.keys) ? result.keys : [];

  // 官方 ListResult 的键条目为 ListKey 对象，键名字段是 key。
  const names = entries
    .map((entry) => (typeof entry === "string" ? entry : entry?.key))
    .filter((name) => typeof name === "string");

  // 官方最佳实践：list 后用 Promise.all 批量读取，而非逐 key 串行等待。
  const raws = await Promise.all(names.map((name) => kv.get(name)));
  return sumCounts(raws);
}

/**
 * 从请求 Cookie 中提取 Clerk 会话 JWT（__session）。
 * JWT 字符集本身 URL 安全，不做 decodeURIComponent。
 * 导出仅供测试。
 */
export function readSessionToken(request) {
  const cookie = request?.headers?.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)__session=([^;]*)/);
  return match ? match[1].trim() : null;
}

/** base64url 段解码为字节（自动补齐 padding）。 */
function base64UrlDecode(segment) {
  const b64 = String(segment).replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * 拆解 JWT 三段并解析 header/payload；任何畸形输入返回 null。
 * 同时返回验签所需的 signingInput 与签名字节。导出仅供测试。
 */
export function parseTokenPayload(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) return null;
  try {
    const decoder = new TextDecoder();
    const header = JSON.parse(decoder.decode(base64UrlDecode(parts[0])));
    const payload = JSON.parse(decoder.decode(base64UrlDecode(parts[1])));
    if (typeof header !== "object" || header === null) return null;
    if (typeof payload !== "object" || payload === null) return null;
    return {
      header,
      payload,
      signingInput: `${parts[0]}.${parts[1]}`,
      signature: base64UrlDecode(parts[2]),
    };
  } catch {
    return null;
  }
}

/**
 * exp/nbf（秒）对照 now（毫秒）判断时间有效性，两侧各留 CLOCK_SKEW_S
 * 容差（对齐 Clerk SDK clockSkewInMs 默认值）。nbf 缺失/非有限数视为
 * 不约束（无害 claim）。导出仅供测试。
 */
export function isTokenFresh(payload, now = Date.now()) {
  const exp = Number(payload?.exp);
  if (!Number.isFinite(exp) || now / 1000 >= exp + CLOCK_SKEW_S) return false;
  const nbf = Number(payload?.nbf);
  return !Number.isFinite(nbf) || now / 1000 >= nbf - CLOCK_SKEW_S;
}

// 模块级 JWKS 缓存：iss → { keys, expiresAt }，避免每次请求都回源。
const jwksCache = new Map();

/**
 * 回源并解析 JWKS。forceRefresh 跳过缓存读取（kid 未命中时的自愈路径，
 * 覆盖密钥轮换与陈旧缓存两种场景），刷新结果仍写回缓存。
 */
async function getJwks(issuer, { forceRefresh = false } = {}) {
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

/** 响应头安全的小标签：只放行受限字符集，其余归一为 "invalid"。 */
function sanitizeTag(value) {
  const raw = String(value ?? "");
  return /^[\w.:-]{1,32}$/.test(raw) ? raw : "invalid";
}

/** issuer/azp 比较前的尾斜杠归一化。 */
function normalizeIssuer(value) {
  return String(value ?? "").replace(/\/+$/, "");
}

/**
 * 验证 Clerk 会话 JWT（详细版）：成功返回 { ok: true, payload }，失败
 * 返回 { ok: false, reason }。reason 取值：parse / alg:<算法> / iss /
 * azp / nbf / exp / sts / kid / sig / crypto——会进 401 响应的
 * x-auth-fail 诊断头，动态拼接的算法名经 sanitizeTag 消毒。
 * 依赖均可注入，测试无需真实网络。导出仅供测试。
 *
 * @param {string} token
 * @param {object} [deps]
 * @param {Array<Record<string, unknown>> | null} [deps.jwks]
 *   直接注入的 JWKS keys（注入时跳过网络回源与刷新重试）。
 * @param {number} [deps.now]
 * @param {Crypto} [deps.crypto]
 * @param {(issuer: string, opts?: { forceRefresh?: boolean }) => Promise<Array<Record<string, unknown>>>} [deps.fetchJwks]
 * @param {Array<string>} [deps.allowedIssuers]
 * @param {Array<string>} [deps.allowedAzp]
 * @returns {Promise<{ ok: true, payload: Record<string, unknown> } | { ok: false, reason: string }>}
 */
export async function verifyTokenDetailed(
  token,
  {
    jwks = null,
    now = Date.now(),
    crypto: cryptoObj = globalThis.crypto,
    fetchJwks = getJwks,
    allowedIssuers = ALLOWED_ISSUERS,
    allowedAzp = ALLOWED_AZP,
  } = {},
) {
  const parsed = parseTokenPayload(token);
  if (!parsed) return { ok: false, reason: "parse" };

  // Clerk 实例间会话签名算法不固定（开发/生产实例分别为 ES256/RS256），
  // 按 header.alg 分派到与实例 JWKS 密钥型一致的算法，其余直接拒绝。
  const alg = parsed.header.alg;
  if (alg !== "ES256" && alg !== "RS256") {
    return { ok: false, reason: `alg:${sanitizeTag(alg)}` };
  }

  const payload = parsed.payload;
  // 钉死 issuer：只信任白名单实例并只回源其 JWKS（官方清单硬性要求，
  // 防"任意 iss + 自造 JWKS"伪造身份），比较前做尾斜杠归一化。
  const iss = normalizeIssuer(payload.iss);
  if (!allowedIssuers.map(normalizeIssuer).includes(iss)) {
    return { ok: false, reason: "iss" };
  }

  // azp 校验（官方建议，防子域 cookie 泄漏攻击）：与官方示例对齐——
  // 存在且不匹配才拒绝，缺失放行。
  if (
    payload.azp
    && !allowedAzp.map(normalizeIssuer).includes(normalizeIssuer(payload.azp))
  ) {
    return { ok: false, reason: "azp" };
  }

  // 时间窗：exp 缺失/已过期、nbf 未生效，各带 CLOCK_SKEW_S 容差。
  const nowSec = now / 1000;
  const exp = Number(payload.exp);
  if (!Number.isFinite(exp) || nowSec >= exp + CLOCK_SKEW_S) {
    return { ok: false, reason: "exp" };
  }
  const nbf = Number(payload.nbf);
  if (Number.isFinite(nbf) && nowSec < nbf - CLOCK_SKEW_S) {
    return { ok: false, reason: "nbf" };
  }
  // sts（官方可选校验）：存在但非 "active" 视为会话未就绪。
  if (payload.sts !== undefined && payload.sts !== "active") {
    return { ok: false, reason: "sts" };
  }

  // 选取公钥：注入 JWKS 时跳过网络路径；回源时 kid 未命中则强制刷新
  // 一次再试（自愈密钥轮换与陈旧缓存），仍无则拒绝。
  let keys = Array.isArray(jwks) ? jwks : await fetchJwks(iss);
  let jwk = keys.find((k) => k?.kid === parsed.header.kid);
  if (!jwk && !Array.isArray(jwks)) {
    keys = await fetchJwks(iss, { forceRefresh: true });
    jwk = keys.find((k) => k?.kid === parsed.header.kid);
  }
  if (!jwk) return { ok: false, reason: "kid" };

  // RS256 的 hash 在 importKey 时绑定进密钥；ECDSA 在 verify 时指定。
  const importParams = alg === "RS256"
    ? { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }
    : { name: "ECDSA", namedCurve: "P-256" };
  const verifyParams = alg === "RS256"
    ? { name: "RSASSA-PKCS1-v1_5" }
    : { name: "ECDSA", hash: "SHA-256" };

  try {
    const key = await cryptoObj.subtle.importKey(
      "jwk", jwk, importParams, false, ["verify"],
    );
    const ok = await cryptoObj.subtle.verify(
      verifyParams,
      key,
      parsed.signature,
      new TextEncoder().encode(parsed.signingInput),
    );
    return ok ? { ok: true, payload } : { ok: false, reason: "sig" };
  } catch {
    // 密钥型与算法不匹配等 Web Crypto 异常一律按验签失败（401）处理。
    return { ok: false, reason: "crypto" };
  }
}

/**
 * 验证 Clerk 会话 JWT，通过返回 payload（含 sub），否则返回 null。
 * verifyTokenDetailed 的薄包装，保持既有导出签名。导出仅供测试。
 *
 * @param {string} token
 * @param {object} [deps]
 * @param {Array<Record<string, unknown>> | null} [deps.jwks]
 *   直接注入的 JWKS keys（注入时跳过网络回源与刷新重试）。
 * @param {number} [deps.now]
 * @param {Crypto} [deps.crypto]
 * @param {(issuer: string, opts?: { forceRefresh?: boolean }) =>
 *   Promise<Array<Record<string, unknown>>>} [deps.fetchJwks]
 * @param {Array<string>} [deps.allowedIssuers]
 * @param {Array<string>} [deps.allowedAzp]
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function verifySessionToken(token, deps = {}) {
  const result = await verifyTokenDetailed(token, deps);
  return result.ok ? result.payload : null;
}

/**
 * 会话验证 + uid 提取：成功返回 { uid, reason: null }；失败返回
 * { uid: null, reason }（no-cookie / verifyTokenDetailed 失败码 / sub），
 * reason 会进 401 响应的 x-auth-fail 诊断头。
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

/** GET：登录后只读快照 { total, users, mine }。 */
export async function onRequestGet({ request }) {
  const kv = getKv();
  if (!kv) return jsonResponse({ error: "kv-not-configured" }, { "x-kv": "unbound" }, 503);
  try {
    const { uid, reason } = await readSessionUid(request);
    if (!uid) {
      return jsonResponse({ error: "unauthorized" }, { "x-auth-fail": reason }, 401);
    }
    const [snapshot, mine] = await Promise.all([
      countTotals(kv),
      kv.get(counterKey(uid)),
    ]);
    const myCount = Number(mine);
    return jsonResponse({
      ...snapshot,
      mine: Number.isFinite(myCount) && myCount >= 0 ? myCount : 0,
    });
  } catch {
    return jsonResponse({ error: "kv-unavailable" }, {}, 503);
  }
}

/** POST：登录后为自己的计数 +1，返回写入后的全局快照与个人计数。 */
export async function onRequestPost({ request }) {
  const kv = getKv();
  if (!kv) return jsonResponse({ error: "kv-not-configured" }, { "x-kv": "unbound" }, 503);
  try {
    const { uid, reason } = await readSessionUid(request);
    if (!uid) {
      return jsonResponse({ error: "unauthorized" }, { "x-auth-fail": reason }, 401);
    }
    const mine = await applyTap(kv, uid);
    const snapshot = await countTotals(kv);
    return jsonResponse({ ...snapshot, mine });
  } catch {
    return jsonResponse({ error: "kv-unavailable" }, {}, 503);
  }
}
