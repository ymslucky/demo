/**
 * TODO List（EdgeOne 边缘函数 + KV 存储）— 仅登录用户可用，数据按账号隔离。
 *
 * 存储模型（EdgeOne Pages KV，官方文档语义）：
 * - 每个登录用户一个 key：todo_user_<归一化 userId>，值为该用户的待办
 *   数组 JSON：[{ id, title, note, done, createdAt, completedAt, dueAt,
 *   remindAt, priority, group }, ...]，数组顺序即展示顺序；客户端采用
 *   快照同步：本地内存为事实源，PUT 端点用 { items } 全量替换服务端
 *   列表（last-write-wins）；所有字段写入前经守卫函数
 *   清洗（cleanStamp/cleanPriority/cleanGroup/trim 截断）；
 * - 单清单封顶 MAX_ITEMS 条、单条标题截断 MAX_TITLE_LEN 字符，防御
 *   KV 值无限膨胀；
 * - KV 为最终一致（约 60s 全球同步），跨设备同步是近实时的。
 *
 * 登录验证（Clerk 会话，对齐官方手动验签清单）：
 * - 读取 __session cookie 中的 Clerk 会话 JWT，按 header.alg 分派验签：
 *   ES256 = ECDSA P-256 + SHA-256（Web Crypto）；RS256 = RSASSA-PKCS1-v1_5
 *   + SHA-256（纯 JS BigInt 实现——生产实例密钥型为 RSA，而边缘运行时
 *   crypto.subtle 不支持 RSA，实测 importKey/verify 抛异常，见 verifyRs256）；
 *   其余算法直接拒绝；
 * - 钉死 issuer：payload.iss 必须命中 ALLOWED_ISSUERS 白名单，JWKS 只从
 *   白名单实例回源——绝不信任 token 内任意 iss（否则攻击者可自造 JWKS
 *   伪造任意身份，构成认证绕过）；
 * - 校验 azp：存在时其 host 须为本站 apex 或其任意子域（后缀点边界
 *   匹配，防子域 cookie 泄漏攻击；旧实例可能不带 azp，缺失时放行）；
 * - exp/nbf 均带 CLOCK_SKEW_S（5s）容差（对齐 Clerk SDK clockSkewInMs
 *   默认值）；sts 存在且非 "active" 时拒绝；
 * - JWKS 按 <iss>/.well-known/jwks.json 回源（模块级缓存 1h），按
 *   header.kid 选取公钥；kid 未命中时强制刷新 JWKS 重试一次（自愈密钥
 *   轮换与陈旧缓存），仍无则拒绝；
 * - 验证通过即视为登录，uid 取 payload.sub。
 *
 * 错误语义：401 unauthorized（未登录/会话过期/验签失败，响应附
 * x-auth-fail 诊断头说明失败环节）、400 invalid-json / invalid-title /
 * invalid-id / invalid-items、404 not-found、503 kv-not-configured /
 * kv-unavailable。
 *
 * 部署路径：/api/todo（functions/api/todo.js）
 */

const KEY_PREFIX = "todo_user_";
const JWKS_TTL_MS = 3_600_000;
/**
 * 访问域名归一化：接受 "rdom.cn" / "https://rdom.cn" / "https://www.rdom.cn"
 * 等写法，剥离协议、路径与 www 前缀，返回裸 apex 域名；空值返回 null。
 * 导出仅供测试。
 *
 * @param {unknown} raw .env 中 SITE_DOMAIN 的原始值
 * @returns {string | null}
 */
export function siteApex(raw) {
  if (typeof raw !== "string") return null;
  const host = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0];
  if (!host) return null;
  return host.startsWith("www.") ? host.slice(4) : host;
}

// 会话 JWT 的 issuer 白名单与 azp 判定基准，全部由站点访问域名派生。
// 钉死 issuer 是 Clerk 官方手动验签清单的硬性要求（防"任意 iss + 自造
// JWKS"伪造身份）；azp 校验防子域 cookie 泄漏攻击。旧实例可能不带
// azp——按官方示例，缺失时放行，存在且不匹配才拒绝。
// 派生规则：issuer 为 Clerk 自定义实例惯例 clerk.<apex>；azp 由 Clerk JS
// 按页面 origin 签发，本站 apex 与其任意子域（*.apex）都放行——子域
// 共享同一身份。换域名时只需在部署环境的 .env 配置 SITE_DOMAIN，
// 无需改代码；未配置默认 rdom.cn。
const SITE_APEX = siteApex(globalThis.process?.env?.SITE_DOMAIN) ?? "rdom.cn";
const ALLOWED_ISSUERS = [`https://clerk.${SITE_APEX}`];
// Clerk SDK 默认 clockSkewInMs = 5000：exp/nbf 判断保持同样的容差，
// 避免边缘节点与签发方时钟的毫秒级偏移误伤刚签发的会话。
const CLOCK_SKEW_S = 5;
// 单用户清单条数上限与各文本字段长度上限（防御 KV 值膨胀）。
const MAX_ITEMS = 200;
const MAX_TITLE_LEN = 200;
const MAX_NOTE_LEN = 2000;
const MAX_GROUP_LEN = 40;
// 优先级档位：0 无 / 1 低 / 2 中 / 3 高。
const MAX_PRIORITY = 3;

/** userId 归一化为合法 KV key（仅数字/字母/下划线，最长 64）。导出仅供测试。 */
export function todoKey(uid) {
  return KEY_PREFIX + String(uid).replace(/[^A-Za-z0-9_]/g, "_").slice(0, 64);
}

function getKv() {
  // 绑定命名空间按控制台设置的变量名（TODO_LIST）注入为边缘函数全局
  // 变量，而非 context.env 属性。typeof 守卫：未绑定时不抛
  // ReferenceError，返回 null 以便上层优雅降级为 503。
  if (typeof TODO_LIST === "undefined") return null;
  return TODO_LIST;
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
// 清单纯逻辑（导出仅供测试；处理器通过 loadItems/saveItems 组合它们）
// ---------------------------------------------------------------------------

/** 生成条目 id：时间戳 base36 + 短随机段（同一毫秒内也不易碰撞）。 */
export function makeItemId(now = Date.now()) {
  return `${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** 时间戳字段守卫：非法/非正数一律归零（0 = 未设置）。 */
function cleanStamp(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 优先级守卫：非整数向下取整并夹取到 [0, MAX_PRIORITY]。 */
function cleanPriority(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(MAX_PRIORITY, Math.max(0, n)) : 0;
}

/** 分组名守卫：trim 后截断；非字符串归为默认分组（""）。 */
function cleanGroup(value) {
  return typeof value === "string" ? value.trim().slice(0, MAX_GROUP_LEN) : "";
}

/**
 * 把 KV 原始值（JSON 字符串或已解析值）守卫式归一化为合法条目数组：
 * 非对象/缺 id/标题为空的条目一律丢弃，标题截断到 MAX_TITLE_LEN，
 * 四要素补充字段（dueAt/remindAt/priority/group）经守卫归一化，
 * 整表截断到最近 MAX_ITEMS 条。任何畸形输入都退化为空数组。
 * 导出仅供测试。
 */
export function normalizeItems(value) {
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const items = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const title = typeof entry.title === "string" ? entry.title.trim() : "";
    if (!title) continue;
    const createdAt = Number(entry.createdAt);
    const completedAt = Number(entry.completedAt);
    items.push({
      id: typeof entry.id === "string" && entry.id ? entry.id : makeItemId(),
      title: title.slice(0, MAX_TITLE_LEN),
      note:
        typeof entry.note === "string" ? entry.note.trim().slice(0, MAX_NOTE_LEN) : "",
      done: entry.done === true,
      createdAt: Number.isFinite(createdAt) ? createdAt : 0,
      // 已完成但缺完成时间回退 createdAt（旧数据进趋势图的近似）。
      completedAt:
        entry.done === true
          ? Number.isFinite(completedAt) && completedAt > 0
            ? completedAt
            : Number.isFinite(createdAt) && createdAt > 0
              ? createdAt
              : 0
          : 0,
      // 四要素补充字段：旧数据缺省时归零/归空（0 = 未设置、"" = 默认分组）。
      dueAt: cleanStamp(entry.dueAt),
      remindAt: cleanStamp(entry.remindAt),
      priority: cleanPriority(entry.priority),
      group: cleanGroup(entry.group),
    });
  }
  return items.slice(0, MAX_ITEMS);
}

/**
 * 新增一条待办：标题 trim 后截断，空标题拒绝（返回 null）；新条目插到
 * 队首并保持总数封顶。id/createdAt 可注入（测试用），缺省自动生成。
 * 导出仅供测试。
 */
export function addTodo(
  items,
  title,
  { id, createdAt, note, dueAt, remindAt, priority, group } = {},
) {
  const clean = String(title ?? "").trim().slice(0, MAX_TITLE_LEN);
  if (!clean) return null;
  const at = Number.isFinite(createdAt) ? createdAt : Date.now();
  return [
    {
      id: typeof id === "string" && id ? id : makeItemId(at),
      title: clean,
      note:
        typeof note === "string" ? note.trim().slice(0, MAX_NOTE_LEN) : "",
      done: false,
      createdAt: at,
      completedAt: 0,
      dueAt: cleanStamp(dueAt),
      remindAt: cleanStamp(remindAt),
      priority: cleanPriority(priority),
      group: cleanGroup(group),
    },
    ...items,
  ].slice(0, MAX_ITEMS);
}

/**
 * 按 id 更新 done/title/note 及四要素（存在的字段才生效，标题 trim + 截断）；
 * done 状态切换联动完成时间（标记完成记录当下，撤销完成清零）。
 * 找不到条目返回 null。不改变原数组。导出仅供测试。
 */
export function updateTodo(items, id, patch = {}, now = Date.now()) {
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return null;
  const next = items.slice();
  next[index] = {
    ...next[index],
    ...(typeof patch.done === "boolean" ? { done: patch.done } : null),
    // 完成时间只由 done 切换驱动，不随 title/note 编辑变化。
    ...(patch.done === true ? { completedAt: now } : null),
    ...(patch.done === false ? { completedAt: 0 } : null),
    ...(typeof patch.title === "string" && patch.title.trim()
      ? { title: patch.title.trim().slice(0, MAX_TITLE_LEN) }
      : null),
    // note 允许设为空串（清空详情），空串之外的空白 trim。
    ...(typeof patch.note === "string"
      ? { note: patch.note.trim().slice(0, MAX_NOTE_LEN) }
      : null),
    // 截止日/提醒时间：数字守卫归一化，0 = 清除；非法输入归零。
    ...(typeof patch.dueAt === "number" ? { dueAt: cleanStamp(patch.dueAt) } : null),
    ...(typeof patch.remindAt === "number"
      ? { remindAt: cleanStamp(patch.remindAt) }
      : null),
    ...(typeof patch.priority === "number"
      ? { priority: cleanPriority(patch.priority) }
      : null),
    // 分组允许设为空串（移回默认分组）。
    ...(typeof patch.group === "string" ? { group: cleanGroup(patch.group) } : null),
  };
  return next;
}

/**
 * 按 id 删除条目；找不到返回 null（区分"删除成功"与"没这条"）。
 * 不改变原数组。导出仅供测试。
 */
export function removeTodo(items, id) {
  const next = items.filter((item) => item.id !== id);
  return next.length === items.length ? null : next;
}

/** 读取当前用户的清单（缺失/损坏按空清单起步）。 */
async function loadItems(kv, uid) {
  return normalizeItems(await kv.get(todoKey(uid)));
}

/** 写回当前用户的清单。 */
async function saveItems(kv, uid, items) {
  await kv.put(todoKey(uid), JSON.stringify(items));
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

// ---------------------------------------------------------------------------
// RS256 纯 JS 验签（BigInt RSA 公钥运算）
//
// 线上实测：EdgeOne 边缘运行时的 crypto.subtle 不支持 RSASSA-PKCS1-v1_5
// （生产 Clerk 实例签发 RS256，importKey/verify 抛异常 → 401 且诊断头
// x-auth-fail: crypto；同一 token 在本地 Node 环境验签通过）。因此 RS256
// 不走 Web Crypto，改为纯 JS 实现 RFC 8017 RSASSA-PKCS1-v1_5 验签：
// - 公钥运算 s^e mod n 用 BigInt 平方-乘法；公开指数 e=65537 仅 17 位，
//   2048 位模长约 17 次模平方 + 1 次模乘，亚毫秒级，无性能担忧；
// - SHA-256 摘要仍用 crypto.subtle.digest（最基础操作，边缘必支持）；
// - 填充比对采用 EMSA-PKCS1-v1_5（RFC 8017 §9.2）：
//   em = 00 01 FF..FF 00 || DigestInfo(SHA-256) || H(signingInput)。
// ---------------------------------------------------------------------------

/** SHA-256 的 DER DigestInfo 前缀（RFC 8017 §9.2 注 1），共 19 字节。 */
const SHA256_DIGEST_INFO = Uint8Array.from([
  0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01,
  0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20,
]);

/** 字节序列 → BigInt（大端序）。 */
function bytesToBigInt(bytes) {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

/** BigInt → 定长 k 字节大端字节序列（调用方保证 value < 2^(8k)，不截断）。 */
function bigIntToBytes(value, length) {
  const bytes = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i -= 1) {
    bytes[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return bytes;
}

/** BigInt 模幂（平方-乘法）：base^exponent mod modulus。 */
function modPow(base, exponent, modulus) {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

/**
 * RS256（RSASSA-PKCS1-v1_5 + SHA-256）纯 JS 验签：签名有效返回 true。
 * jwk 为 RSA 公钥（kty "RSA"，n/e 为 base64url）；cryptoObj 仅用于
 * subtle.digest。任何非法输入（解码失败/长度不符/填充错误）一律 false。
 * 导出仅供测试。
 *
 * @param {Record<string, unknown>} jwk
 * @param {string} signingInput
 * @param {Uint8Array} signature
 * @param {Crypto} cryptoObj
 * @returns {Promise<boolean>}
 */
export async function verifyRs256(jwk, signingInput, signature, cryptoObj) {
  try {
    // 标准 RSA JWK 的 n 按"去前导零"序列化，解码后恰为模长 k 字节。
    const nBytes = base64UrlDecode(jwk.n);
    const k = nBytes.length;
    if (k < 20 || signature.length !== k) return false;
    const n = bytesToBigInt(nBytes);
    const s = bytesToBigInt(signature);
    // RFC 8017 §5.2.2 步骤 2b：s 不在 [0, n-1] 内即无效。
    if (s >= n) return false;

    // RSA 公钥运算：em = s^e mod n。
    const e = bytesToBigInt(base64UrlDecode(jwk.e));
    const em = bigIntToBytes(modPow(s, e, n), k);

    // EMSA-PKCS1-v1_5 编码比对：00 01 FF..FF 00 || DigestInfo || H(m)。
    const hash = new Uint8Array(
      await cryptoObj.subtle.digest("SHA-256", new TextEncoder().encode(signingInput)),
    );
    const t = SHA256_DIGEST_INFO.length + hash.length;
    if (k < t + 11 || em[0] !== 0x00 || em[1] !== 0x01) return false;
    let idx = 2;
    while (idx < k - t - 1) {
      if (em[idx] !== 0xff) return false;
      idx += 1;
    }
    if (em[idx] !== 0x00) return false;
    idx += 1;
    for (let i = 0; i < SHA256_DIGEST_INFO.length; i += 1) {
      if (em[idx + i] !== SHA256_DIGEST_INFO[i]) return false;
    }
    idx += SHA256_DIGEST_INFO.length;
    for (let i = 0; i < hash.length; i += 1) {
      if (em[idx + i] !== hash[i]) return false;
    }
    return true;
  } catch {
    return false;
  }
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

/** issuer 比较前的尾斜杠归一化。 */
function normalizeIssuer(value) {
  return String(value ?? "").replace(/\/+$/, "");
}

/**
 * azp 的来源 origin 是否属于本站：host 等于 apex，或以 ".<apex>" 结尾
 * （任意子域）。前导点保证边界——仅共享后缀片段的域名不会误匹配。
 * 导出仅供测试。
 */
export function isAllowedAzp(azp, apex = SITE_APEX) {
  if (typeof azp !== "string" || typeof apex !== "string") return false;
  const host = azp
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split(/[:/?]/)[0];
  return !!host && (host === apex || host.endsWith(`.${apex}`));
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
 * @param {string} [deps.azpApex] azp host 判定基准（apex 及其任意子域放行）
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
    azpApex = SITE_APEX,
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

  // azp 校验（官方建议，防子域 cookie 泄漏攻击）：存在时其 host 须为
  // 本站 apex 或其任意子域；缺失放行（与官方示例对齐）。
  if (payload.azp && !isAllowedAzp(payload.azp, azpApex)) {
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

  // 验签分派：RS256 走上方纯 JS 实现（边缘 subtle 不支持 RSA，背景见
  // verifyRs256 注释），单一确定性路径；ES256 走 Web Crypto（ECDSA
  // P-256 边缘支持良好，hash 在 verify 时指定）。
  if (alg === "RS256") {
    const ok = await verifyRs256(jwk, parsed.signingInput, parsed.signature, cryptoObj);
    return ok ? { ok: true, payload } : { ok: false, reason: "sig" };
  }
  try {
    const key = await cryptoObj.subtle.importKey(
      "jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"],
    );
    const ok = await cryptoObj.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
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
 * verifyTokenDetailed 的薄包装。导出仅供测试。
 *
 * @param {string} token
 * @param {object} [deps]
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function verifySessionToken(token, deps = {}) {
  const result = await verifyTokenDetailed(token, deps);
  return result.ok ? result.payload : null;
}

/**
 * 会话验证 + uid 提取：成功返回 { uid, reason: null }；失败返回
 * { uid: null, reason }（no-cookie / verifyTokenDetailed 失败码 / sub），
 * reason 会进 401 响应的 x-auth-fail 诊断头。issuer 白名单与 azp 判定
 * 基准见模块顶部常量（由 SITE_DOMAIN 派生）。
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

/** GET：登录后返回自己的清单 { items }。 */
export async function onRequestGet({ request }) {
  const kv = getKv();
  if (!kv) return jsonResponse({ error: "kv-not-configured" }, { "x-kv": "unbound" }, 503);
  try {
    const { uid, reason } = await readSessionUid(request);
    if (!uid) {
      return jsonResponse({ error: "unauthorized" }, { "x-auth-fail": reason }, 401);
    }
    return jsonResponse({ items: await loadItems(kv, uid) });
  } catch {
    return jsonResponse({ error: "kv-unavailable" }, {}, 503);
  }
}

/** POST：登录后为自己的清单新增一条，返回写入后的清单（201）。 */
export async function onRequestPost({ request }) {
  const kv = getKv();
  if (!kv) return jsonResponse({ error: "kv-not-configured" }, { "x-kv": "unbound" }, 503);
  try {
    const { uid, reason } = await readSessionUid(request);
    if (!uid) {
      return jsonResponse({ error: "unauthorized" }, { "x-auth-fail": reason }, 401);
    }
    const body = await readJsonBody(request);
    if (!body) return jsonResponse({ error: "invalid-json" }, {}, 400);
    const items = addTodo(await loadItems(kv, uid), body.title, {
      note: body.note,
      dueAt: body.dueAt,
      remindAt: body.remindAt,
      priority: body.priority,
      group: body.group,
    });
    if (!items) return jsonResponse({ error: "invalid-title" }, {}, 400);
    await saveItems(kv, uid, items);
    return jsonResponse({ items }, {}, 201);
  } catch {
    return jsonResponse({ error: "kv-unavailable" }, {}, 503);
  }
}

/** PATCH：登录后按 id 更新 done/title/note 及四要素（done 切换联动完成时间），返回写入后的清单。 */
export async function onRequestPatch({ request }) {
  const kv = getKv();
  if (!kv) return jsonResponse({ error: "kv-not-configured" }, { "x-kv": "unbound" }, 503);
  try {
    const { uid, reason } = await readSessionUid(request);
    if (!uid) {
      return jsonResponse({ error: "unauthorized" }, { "x-auth-fail": reason }, 401);
    }
    const body = await readJsonBody(request);
    if (!body) return jsonResponse({ error: "invalid-json" }, {}, 400);
    const id = typeof body.id === "string" && body.id ? body.id : null;
    if (!id) return jsonResponse({ error: "invalid-id" }, {}, 400);
    const patch = {};
    if (typeof body.done === "boolean") patch.done = body.done;
    if (typeof body.title === "string") patch.title = body.title;
    if (typeof body.note === "string") patch.note = body.note;
    if (typeof body.dueAt === "number") patch.dueAt = body.dueAt;
    if (typeof body.remindAt === "number") patch.remindAt = body.remindAt;
    if (typeof body.priority === "number") patch.priority = body.priority;
    if (typeof body.group === "string") patch.group = body.group;
    const items = updateTodo(await loadItems(kv, uid), id, patch);
    if (!items) return jsonResponse({ error: "not-found" }, {}, 404);
    await saveItems(kv, uid, items);
    return jsonResponse({ items });
  } catch {
    return jsonResponse({ error: "kv-unavailable" }, {}, 503);
  }
}

/**
 * PUT：登录后用 { items } 快照全量替换自己的清单（客户端写后队列的
 * 合并写入口——本地内存是事实源，服务端不做增量合并，last-write-wins）。
 * 快照经 normalizeItems 守卫清洗（空标题丢弃/截断/封顶）后整表写入，
 * 返回写入后的清单。items 缺失或非数组回 400 invalid-items。
 */
export async function onRequestPut({ request }) {
  const kv = getKv();
  if (!kv) return jsonResponse({ error: "kv-not-configured" }, { "x-kv": "unbound" }, 503);
  try {
    const { uid, reason } = await readSessionUid(request);
    if (!uid) {
      return jsonResponse({ error: "unauthorized" }, { "x-auth-fail": reason }, 401);
    }
    const body = await readJsonBody(request);
    if (!body) return jsonResponse({ error: "invalid-json" }, {}, 400);
    if (!Array.isArray(body.items)) {
      return jsonResponse({ error: "invalid-items" }, {}, 400);
    }
    const items = normalizeItems(body.items);
    await saveItems(kv, uid, items);
    return jsonResponse({ items });
  } catch {
    return jsonResponse({ error: "kv-unavailable" }, {}, 503);
  }
}

/** DELETE：登录后按 id 删除条目（?id= 优先，回落 body { id }）。 */
export async function onRequestDelete({ request }) {
  const kv = getKv();
  if (!kv) return jsonResponse({ error: "kv-not-configured" }, { "x-kv": "unbound" }, 503);
  try {
    const { uid, reason } = await readSessionUid(request);
    if (!uid) {
      return jsonResponse({ error: "unauthorized" }, { "x-auth-fail": reason }, 401);
    }
    let id = null;
    try {
      id = new URL(request.url).searchParams.get("id");
    } catch {
      id = null;
    }
    if (!id) {
      const body = await readJsonBody(request);
      if (typeof body?.id === "string" && body.id) id = body.id;
    }
    if (!id) return jsonResponse({ error: "invalid-id" }, {}, 400);
    const items = removeTodo(await loadItems(kv, uid), id);
    if (!items) return jsonResponse({ error: "not-found" }, {}, 404);
    await saveItems(kv, uid, items);
    return jsonResponse({ items });
  } catch {
    return jsonResponse({ error: "kv-unavailable" }, {}, 503);
  }
}