import { cookies } from "next/headers";

/**
 * Next.js 服务端会话读取（不依赖 clerkMiddleware 的 auth()）。
 *
 * 生产教训（EdgeOne Pages）：适配器在边缘不透传 proxy.ts 的 clerkMiddleware
 * 装饰——SSR 页面里调用 auth() 会抛 "Clerk can't detect usage of
 * clerkMiddleware()"（线上 500；本地 next dev 正常，纯环境差异）。与边缘
 * 函数（functions/api/todo.js）同一既定路线：直接读取 __session cookie 并
 * 按八步清单手动验签。运行时差异：Next SSR 是 Node 22（edgeone.json
 * nodeVersion），Web Crypto 完整支持 RSA——RS256 走标准 subtle.verify 即可，
 * 无需边缘函数里的纯 JS BigInt 路径。
 *
 * 八步清单：parse → alg 分派（ES256/RS256）→ issuer 白名单（SITE_DOMAIN
 * 派生，未配置默认 rdom.cn）→ azp（缺失放行）→ exp/nbf（5s 容差）→ sts →
 * kid 匹配（未命中强制刷新 JWKS 一次）→ 验签。通过后返回完整 claims；
 * 角色判定见 app/lib/rbac.ts（claims.metadata.role 随 JWT 签名下发）。
 */

const JWKS_TTL_MS = 3_600_000;
const CLOCK_SKEW_S = 5;
const DEFAULT_SITE_APEX = "rdom.cn";
const SESSION_COOKIE = "__session";

type Jwk = Record<string, unknown>;

export type SessionClaims = CustomJwtSessionClaims & Record<string, unknown>;

/** 访问域名 → 裸 apex（剥协议/路径/www）；非字符串或空值返回 null。 */
function siteApex(raw: string | undefined): string | null {
  if (typeof raw !== "string") return null;
  const host = raw.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
  if (!host) return null;
  return host.startsWith("www.") ? host.slice(4) : host;
}

/** issuer 比较前的尾斜杠归一化。 */
function normalizeIssuer(value: unknown): string {
  return String(value ?? "").replace(/\/+$/, "");
}

/** azp host 是否等于 apex 或其任意子域（前导点边界匹配）。 */
function isAllowedAzp(azp: unknown, apex: string): boolean {
  if (typeof azp !== "string") return false;
  const host = azp.trim().toLowerCase().replace(/^https?:\/\//, "").split(/[:/?]/)[0];
  return !!host && (host === apex || host.endsWith(`.${apex}`));
}

/** base64url 段解码为字节（自动补齐 padding）；标注 ArrayBuffer 以满足 BufferSource。 */
function base64UrlDecode(segment: string): Uint8Array<ArrayBuffer> {
  const b64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 拆解 JWT 三段并解析 header/payload；任何畸形输入返回 null。 */
function parseToken(token: string): {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signingInput: string;
  signature: Uint8Array<ArrayBuffer>;
} | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) return null;
  try {
    const decoder = new TextDecoder();
    const header = JSON.parse(decoder.decode(base64UrlDecode(parts[0])));
    const payload = JSON.parse(decoder.decode(base64UrlDecode(parts[1])));
    if (typeof header !== "object" || header === null) return null;
    if (typeof payload !== "object" || payload === null) return null;
    return {
      header: header as Record<string, unknown>,
      payload: payload as Record<string, unknown>,
      signingInput: `${parts[0]}.${parts[1]}`,
      signature: base64UrlDecode(parts[2]),
    };
  } catch {
    return null;
  }
}

/** 模块级 JWKS 缓存：iss → { keys, expiresAt }，避免每次请求都回源。 */
const jwksCache = new Map<string, { keys: Jwk[]; expiresAt: number }>();

/** 回源并解析 JWKS；forceRefresh 跳过缓存（kid 未命中时的自愈路径）。 */
async function getJwks(
  issuer: string,
  { forceRefresh = false }: { forceRefresh?: boolean } = {},
): Promise<Jwk[]> {
  const iss = normalizeIssuer(issuer);
  const cached = jwksCache.get(iss);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.keys;

  const res = await fetch(`${iss}/.well-known/jwks.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`jwks-http-${res.status}`);
  const data = (await res.json()) as { keys?: unknown };
  const keys = Array.isArray(data?.keys) ? (data.keys as Jwk[]) : null;
  if (!keys) throw new Error("jwks-shape");
  jwksCache.set(iss, { keys, expiresAt: Date.now() + JWKS_TTL_MS });
  return keys;
}

/**
 * 八步验签（Node Web Crypto，ES256 / RS256 均走标准 subtle 路径）。
 * 任何一步失败返回 null（fail-closed）。
 */
async function verifySessionToken(token: string, apex: string): Promise<SessionClaims | null> {
  const parsed = parseToken(token);
  if (!parsed) return null;

  // 步骤 2：按 header.alg 分派——Clerk dev 实例签 ES256、生产实例签 RS256。
  const alg = parsed.header.alg;
  if (alg !== "ES256" && alg !== "RS256") return null;

  // 步骤 3：钉死 issuer 白名单（防"任意 iss + 自造 JWKS"伪造身份）。
  const iss = normalizeIssuer(parsed.payload.iss);
  if (iss !== normalizeIssuer(`https://clerk.${apex}`)) return null;

  // 步骤 4：azp 校验（缺失放行，对齐官方示例）。
  if (parsed.payload.azp && !isAllowedAzp(parsed.payload.azp, apex)) return null;

  // 步骤 5：时间窗（exp/nbf 双侧 5s 容差）。
  const nowSec = Date.now() / 1000;
  const exp = Number(parsed.payload.exp);
  if (!Number.isFinite(exp) || nowSec >= exp + CLOCK_SKEW_S) return null;
  const nbf = Number(parsed.payload.nbf);
  if (Number.isFinite(nbf) && nowSec < nbf - CLOCK_SKEW_S) return null;

  // 步骤 6：sts（官方可选校验）。
  if (parsed.payload.sts !== undefined && parsed.payload.sts !== "active") return null;

  // 步骤 7：选钥；kid 未命中强制刷新 JWKS 一次再试（密钥轮换自愈）。
  let keys: Jwk[];
  try {
    keys = await getJwks(iss);
  } catch {
    return null;
  }
  let jwk = keys.find((k) => k?.kid === parsed.header.kid);
  if (!jwk) {
    try {
      keys = await getJwks(iss, { forceRefresh: true });
    } catch {
      return null;
    }
    jwk = keys.find((k) => k?.kid === parsed.header.kid);
  }
  if (!jwk) return null;

  // 步骤 8：验签（Web Crypto；密钥型不匹配等异常按失败处理）。
  try {
    const encoder = new TextEncoder();
    if (alg === "RS256") {
      const key = await crypto.subtle.importKey(
        "jwk",
        jwk as JsonWebKey,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );
      const ok = await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        key,
        parsed.signature,
        encoder.encode(parsed.signingInput),
      );
      return ok ? (parsed.payload as SessionClaims) : null;
    }
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk as JsonWebKey,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      parsed.signature,
      encoder.encode(parsed.signingInput),
    );
    return ok ? (parsed.payload as SessionClaims) : null;
  } catch {
    return null;
  }
}

/**
 * 读取并验签当前请求的 Clerk 会话 claims；未登录 / 验签失败返回 null。
 * 服务端组件与 server action 均可调用（不依赖 clerkMiddleware）。
 */
export async function readSessionClaims(): Promise<SessionClaims | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const apex = siteApex(process.env.SITE_DOMAIN) ?? DEFAULT_SITE_APEX;
  try {
    return await verifySessionToken(token, apex);
  } catch {
    return null;
  }
}
