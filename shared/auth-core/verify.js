/**
 * 会话 JWT 验签核心（单一真源 @lucky/auth-core，自 functions/api/todo.js
 * 移植）——对齐 Clerk 官方手动验签清单：
 * - 按 header.alg 分派验签：ES256 = ECDSA P-256 + SHA-256（Web Crypto）；
 *   RS256 = RSASSA-PKCS1-v1_5 + SHA-256（纯 JS BigInt 实现——生产实例
 *   密钥型为 RSA，而边缘运行时 crypto.subtle 不支持 RSA，实测
 *   importKey/verify 抛异常，见 verifyRs256）；其余算法直接拒绝；
 * - 钉死 issuer：payload.iss 必须命中 allowedIssuers 白名单，JWKS 只从
 *   白名单实例回源——绝不信任 token 内任意 iss（否则攻击者可自造 JWKS
 *   伪造任意身份，构成认证绕过）；
 * - 校验 azp：存在时其 host 须为本站 apex 或其任意子域（后缀点边界
 *   匹配，防子域 cookie 泄漏攻击；旧实例可能不带 azp，缺失时放行）；
 * - exp/nbf 均带 CLOCK_SKEW_S（5s）容差（对齐 Clerk SDK clockSkewInMs
 *   默认值）；sts 存在且非 "active" 时拒绝；
 * - JWKS 按 <iss>/.well-known/jwks.json 回源（模块级缓存 1h，见 keys.js），
 *   按 header.kid 选取公钥；kid 未命中时强制刷新 JWKS 重试一次（自愈密钥
 *   轮换与陈旧缓存），仍无则拒绝；
 * - 验证通过返回 { ok: true, payload }，uid 取 payload.sub（调用方职责）。
 *
 * 包不读环境变量：issuer 白名单（allowedIssuers）与 azp 判定基准
 * （azpApex）由调用方经 deriveIssuers / siteApex 派生后传入；缺省为
 * 空白名单 / 空 apex——fail-closed（任何 iss 拒绝；带 azp 的 token 一律
 * 拒绝，azp 缺失仍放行）。normalizeIssuer / isAllowedAzp 复用
 * ./predicates.js。
 */

import { isAllowedAzp, normalizeIssuer } from "./predicates.js";
import { getJwks } from "./keys.js";

// Clerk SDK 默认 clockSkewInMs = 5000：exp/nbf 判断保持同样的容差，
// 避免边缘节点与签发方时钟的毫秒级偏移误伤刚签发的会话。
const CLOCK_SKEW_S = 5;

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

/**
 * ES256（ECDSA P-256 + SHA-256）Web Crypto 验签：签名有效返回 true。
 * 与 verifyRs256 对称的算法原语；importKey/verify 异常向上抛出，由
 * verifySessionDetailed 统一按 "crypto" 失败处理。导出仅供测试。
 *
 * @param {Record<string, unknown>} jwk
 * @param {string} signingInput
 * @param {Uint8Array} signature
 * @param {Crypto} cryptoObj
 * @returns {Promise<boolean>}
 */
export async function verifyEs256(jwk, signingInput, signature, cryptoObj) {
  const key = await cryptoObj.subtle.importKey(
    "jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"],
  );
  return cryptoObj.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    signature,
    new TextEncoder().encode(signingInput),
  );
}

/** 响应头安全的小标签：只放行受限字符集，其余归一为 "invalid"。 */
function sanitizeTag(value) {
  const raw = String(value ?? "");
  return /^[\w.:-]{1,32}$/.test(raw) ? raw : "invalid";
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
 * @param {Array<string>} [deps.allowedIssuers] issuer 白名单（缺省为空——fail-closed）
 * @param {string} [deps.azpApex] azp host 判定基准（apex 及其任意子域放行；缺省空串时带 azp 的 token 一律拒绝，azp 缺失仍放行）
 * @returns {Promise<{ ok: true, payload: Record<string, unknown> } | { ok: false, reason: string }>}
 */
export async function verifySessionDetailed(
  token,
  {
    jwks = null,
    now = Date.now(),
    crypto: cryptoObj = globalThis.crypto,
    fetchJwks = getJwks,
    allowedIssuers = [],
    azpApex = "",
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
    const ok = await verifyEs256(jwk, parsed.signingInput, parsed.signature, cryptoObj);
    return ok ? { ok: true, payload } : { ok: false, reason: "sig" };
  } catch {
    // 密钥型与算法不匹配等 Web Crypto 异常一律按验签失败（401）处理。
    return { ok: false, reason: "crypto" };
  }
}

/**
 * 验证 Clerk 会话 JWT，通过返回 payload（含 sub），否则返回 null。
 * verifySessionDetailed 的薄包装。导出仅供测试。
 *
 * @param {string} token
 * @param {object} [deps]
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function verifySessionToken(token, deps = {}) {
  const result = await verifySessionDetailed(token, deps);
  return result.ok ? result.payload : null;
}
