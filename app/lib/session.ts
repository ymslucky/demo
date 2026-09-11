import { cookies } from "next/headers";
import { verifyToken } from "@clerk/nextjs/server";
import { createRemoteJWKSet, decodeJwt, jwtVerify } from "jose";

/**
 * Next.js 服务端会话读取（不依赖 clerkMiddleware 的 auth()）。
 *
 * 背景（EdgeOne Pages 生产限制）：适配器不透传 proxy.ts 中 clerkMiddleware
 * 的请求装饰——SSR 页面 / server action 里调用 auth() 会抛
 * "Clerk can't detect usage of clerkMiddleware()"（线上 500；本地 next dev
 * 正常，纯环境差异）。因此这里直接读取 __session cookie 自行验签。
 *
 * ── 验签通道链（按序取第一条可用通道）────────────────────────────
 * 1. PEM（CLERK_JWT_PUBLIC_KEY，Dashboard → API keys → Public key）：
 *    verifyToken 的 jwtKey 路径，networkless——已配置该变量的环境最优，
 *    也免一次 JWKS 获取 RTT（性能余量）。仅适用 RS256 实例。
 * 2. JWKS（默认通道，对齐工具页边缘函数 functions/api/todo.js §3）：
 *    token 的 iss 必须命中白名单（CLERK_ISSUER 显式列表，或由 SITE_DOMAIN
 *    派生的 https://clerk.<apex>——未配置默认 rdom.cn），公钥从该 iss 的
 *    公开端点 <iss>/.well-known/jwks.json 获取（jose createRemoteJWKSet，
 *    模块级缓存 + kid 未命中自动重取——密钥轮换自愈）。生产环境出网
 *    api.clerk.com 不可达时的自愈主通道：自定义域国内可达。
 *    安全关卡与边缘函数一致：JWKS URL 只按白名单条目构造（token 可控的
 *    iss 指向攻击者 JWKS = 认证绕过，绝不从 token iss 直接构造）。
 * 3. SK 回源（兜底，iss 不在白名单时——如本地 dev 实例）：
 *    verifyToken 的 secretKey 路径，JWKS 从官方 Backend API（api.clerk.com）
 *    回源。本地网络可达；生产出网受限时该通道会失败（历史事故：生产
 *    verify-failed 且错误摘要为空）——这正是通道 2 存在的理由。
 *
 * CLERK_SECRET_KEY 始终必需（用户搜索 / 角色管理的 clerkClient 依赖它）。
 *
 * 可选加固（与边缘函数同语义）：CLERK_AZP_ORIGINS（逗号分隔 origin）设置
 * 时，azp 存在且不命中才拒绝（缺失放行——旧实例可能不带 azp）。
 *
 * 诊断（对齐边缘函数 x-auth-fail 的逐关哲学）：readSessionClaimsDetailed
 * 返回失败原因（no-cookie / no-key / verify-failed / issuer-mismatch）、
 * detail（错误摘要——message → reason → JSON 三级兜底，绝不允许空白）、
 * input（via=<pem|jwks|sk> 通道标记 + 密钥材料存在性/形态摘要），供门控页
 * 就地展示诊断卡而非静默弹回首页。所有失败一律不返回 claims（fail-closed），
 * 绝不抛 500。
 */

const SESSION_COOKIE = "__session";
const DETAIL_MAX_LENGTH = 200;
// 与 Clerk SDK 默认 clockSkewInMs 对齐，避免时钟毫秒级偏移误伤刚签发的会话。
const CLOCK_TOLERANCE_MS = 5000;
// Clerk 实例并不统一签名算法（dev/test 签 ES256、生产常为 RS256）——绝不钉死单一算法。
const ALGORITHMS = ["ES256", "RS256"] as const;

export type SessionClaims = CustomJwtSessionClaims & Record<string, unknown>;

export type SessionFailureReason =
  | "no-cookie"
  | "no-key"
  | "verify-failed"
  | "issuer-mismatch";

export type SessionResult = {
  claims: SessionClaims | null;
  reason: SessionFailureReason | null;
  /** 失败细节摘要（脱敏截断）；成功时为 null。 */
  detail: string | null;
  /** 通道标记 + 密钥材料形态摘要；环境/通道相关失败时非 null。 */
  input: string | null;
};

/** issuer 比较前的尾斜杠归一化。 */
function normalizeIssuer(value: unknown): string {
  return String(value ?? "").replace(/\/+$/, "");
}

function commaList(raw: string | undefined): string[] | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const items = raw.split(",").map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : null;
}

/**
 * 访问域名归一化（与 functions/api/todo.js 的 siteApex 保持一致）：接受
 * "rdom.cn" / "https://rdom.cn" / "https://www.rdom.cn" 等写法，剥协议、
 * 路径与 www 前缀；空值返回 null。（纯函数，可单测。）
 */
export function siteApex(raw: string | undefined): string | null {
  if (typeof raw !== "string") return null;
  const host = raw.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
  if (!host) return null;
  return host.startsWith("www.") ? host.slice(4) : host;
}

/**
 * JWKS 通道的 issuer 白名单（纯函数，可单测）：CLERK_ISSUER 显式列表优先
 * （兼容旧可选加固语义），否则按 Clerk 自定义实例惯例由 SITE_DOMAIN 派生
 * https://clerk.<apex>；未配置 SITE_DOMAIN 默认 rdom.cn——与边缘函数的
 * 派生规则逐字对齐，换域名只改部署环境变量，无需改代码。
 */
export function allowedIssuers(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const explicit = commaList(env.CLERK_ISSUER);
  if (explicit) return explicit;
  return [`https://clerk.${siteApex(env.SITE_DOMAIN) ?? "rdom.cn"}`];
}

/**
 * 从 verifyToken/jose 的错误对象提取一行可展示的摘要（纯函数，可单测）。
 * 三级兜底：message → reason → JSON 序列化——生产实测上游可能抛出
 * 不带标准 message 的错误对象（EdgeOne SSR 运行时差异），诊断卡
 * 绝不允许因此空白。只取错误描述字段（message / reason 是原因码或
 * 网络失败说明，不含 token 与密钥）；空白归一并截断，防止超长破坏
 * 诊断卡排版。
 */
export function sanitizeVerifyDetail(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  const pick = (value: string): string | null => {
    const line = value.replace(/\s+/g, " ").trim();
    return line ? line.slice(0, DETAIL_MAX_LENGTH) : null;
  };
  if (typeof error === "string") return pick(error);
  if (error instanceof Error) return pick(error.message);
  // 非 Error 对象（上游行为变化 / 运行时差异）：message → reason → JSON。
  const candidate = error as { message?: unknown; reason?: unknown };
  if (typeof candidate.message === "string") {
    const fromMessage = pick(candidate.message);
    if (fromMessage) return fromMessage;
  }
  if (candidate.reason !== undefined && candidate.reason !== null) {
    const fromReason = pick(String(candidate.reason));
    if (fromReason) return fromReason;
  }
  try {
    return pick(JSON.stringify(error)) ?? pick(String(error));
  } catch {
    return pick(String(error));
  }
}

/**
 * 解析验签密钥材料（纯函数，可单测）。PEM 中的字面 "\n"（反斜杠+n）
 * 还原为换行，兼容控制台环境变量不支持多行输入的部署面板。
 */
export function resolveVerifyKeys(
  env: Record<string, string | undefined> = process.env,
): { secretKey: string | null; jwtKey: string | null } {
  const pick = (name: string): string | null => {
    const raw = env[name];
    const value = typeof raw === "string" ? raw.trim() : "";
    return value ? value : null;
  };
  const jwtRaw = pick("CLERK_JWT_PUBLIC_KEY");
  return {
    secretKey: pick("CLERK_SECRET_KEY"),
    jwtKey: jwtRaw ? jwtRaw.replace(/\\n/g, "\n") : null,
  };
}

/**
 * 验签输入侧摘要（纯函数，可单测）：只含通道标记、存在性布尔与形态线索
 * （PEM 长度 / 前 10 字符 / 是否为字面 \n 转义），不含任何密钥正文。
 */
export function describeVerifyInput(
  env: Record<string, string | undefined> = process.env,
  via?: "pem" | "jwks" | "sk",
): string {
  const { secretKey, jwtKey } = resolveVerifyKeys(env);
  const channel = via ? `via=${via} ` : "";
  const skPart = secretKey ? "sk:yes" : "sk:no";
  if (!jwtKey) return `${channel}${skPart} pem:no`;
  const head = jwtKey.slice(0, 10).replace(/\s+/g, "");
  const raw = env.CLERK_JWT_PUBLIC_KEY ?? "";
  const escaped = raw.includes("\\n");
  return `${channel}${skPart} pem:yes(len=${jwtKey.length},head=${head},esc=${escaped ? 1 : 0})`;
}

// ── JWKS 通道（jose）─────────────────────────────────────────────
// 模块级缓存：per-issuer 一个 RemoteJWKSet（内部自带 KV 缓存与 kid 未命中
// 的 cooldown 重取——密钥轮换自愈由 jose 承接，对应边缘函数清单第 7 步）。
const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function remoteJwks(issuer: string): ReturnType<typeof createRemoteJWKSet> {
  let jwks = jwksByIssuer.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
    jwksByIssuer.set(issuer, jwks);
  }
  return jwks;
}

/**
 * 解析未验签 token 的 iss 并匹配白名单（纯逻辑，依赖 jose decodeJwt）。
 * 返回白名单条目（而非 token iss 原文）——JWKS URL 只按白名单构造；
 * 解析失败或未命中返回 null（调用方落 SK 兜底通道）。
 */
export function matchAllowedIssuer(token: string, issuers: string[]): string | null {
  try {
    const { iss } = decodeJwt(token);
    const normalized = normalizeIssuer(iss);
    return issuers.find((allowed) => normalizeIssuer(allowed) === normalized) ?? null;
  } catch {
    return null;
  }
}

/**
 * 读取并验签当前请求的 Clerk 会话 claims；未登录 / 环境无任何可用验签
 * 通道 / 验签失败一律 claims: null 并附 reason + detail + input
 * （fail-closed）。服务端组件与 server action 均可调用（不依赖
 * clerkMiddleware）。
 */
export async function readSessionClaimsDetailed(): Promise<SessionResult> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return { claims: null, reason: "no-cookie", detail: null, input: null };

  const { secretKey, jwtKey } = resolveVerifyKeys();
  const issuers = allowedIssuers();
  const azpAllowlist = commaList(process.env.CLERK_AZP_ORIGINS);

  try {
    // 通道 1：PEM networkless（verifyToken 原生 jwtKey 路径）。
    if (jwtKey) {
      const { data, errors } = await verifyToken(token, {
        jwtKey,
        authorizedParties: azpAllowlist ?? undefined,
      });
      const claims = (data ?? null) as SessionClaims | null;
      if (errors || !claims) {
        const first = (errors as unknown[] | undefined)?.[0];
        return {
          claims: null,
          reason: "verify-failed",
          detail: sanitizeVerifyDetail(first) ?? sanitizeVerifyDetail(errors ?? null),
          input: describeVerifyInput(undefined, "pem"),
        };
      }
      return claimsGate(claims, "pem", issuers);
    }

    // 通道 2：JWKS（token iss 命中白名单——工具页同款公开端点）。
    const issuer = matchAllowedIssuer(token, issuers);
    if (issuer) {
      const { payload } = await jwtVerify(token, remoteJwks(issuer), {
        issuer,
        algorithms: [...ALGORITHMS],
        clockTolerance: CLOCK_TOLERANCE_MS,
      });
      const claims = payload as SessionClaims;
      // azp 可选加固（缺失放行、存在须命中——与边缘函数清单第 4 步同语义）。
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

    // 通道 3：SK 回源兜底（iss 不在白名单——本地 dev 实例等）。
    if (secretKey) {
      const { data, errors } = await verifyToken(token, {
        secretKey,
        authorizedParties: azpAllowlist ?? undefined,
      });
      const claims = (data ?? null) as SessionClaims | null;
      if (errors || !claims) {
        const first = (errors as unknown[] | undefined)?.[0];
        return {
          claims: null,
          reason: "verify-failed",
          detail: sanitizeVerifyDetail(first) ?? sanitizeVerifyDetail(errors ?? null),
          input: describeVerifyInput(undefined, "sk"),
        };
      }
      return claimsGate(claims, "sk", issuers);
    }

    // 三个通道都不可用：无任何密钥材料。
    return { claims: null, reason: "no-key", detail: null, input: describeVerifyInput() };
  } catch (error) {
    return {
      claims: null,
      reason: "verify-failed",
      detail: sanitizeVerifyDetail(error),
      input: describeVerifyInput(undefined, jwtKey ? "pem" : matchAllowedIssuer(token, issuers) ? "jwks" : "sk"),
    };
  }
}

/**
 * 通道 1/3（verifyToken 路径）成功后的可选加固门：CLERK_ISSUER 显式设置时
 * 钉死 issuer（detail 带实际 iss——公开 URL，非敏感）。azp 已由
 * verifyToken 的 authorizedParties 校验；JWKS 通道的 issuer 校验由 jose
 * 在验签时完成，都不经过此处。
 */
function claimsGate(claims: SessionClaims, via: "pem" | "sk", issuers: string[]): SessionResult {
  // verifyToken 已按 authorizedParties 校验 azp；这里只补 issuer 钉死。
  const normalized = normalizeIssuer(claims.iss);
  const issuerAllowed = issuers.some((allowed) => normalizeIssuer(allowed) === normalized);
  if (process.env.CLERK_ISSUER && !issuerAllowed) {
    return {
      claims: null,
      reason: "issuer-mismatch",
      detail: normalized,
      input: describeVerifyInput(undefined, via),
    };
  }
  return { claims, reason: null, detail: null, input: null };
}

/** 便捷封装：只要 claims（null = 未登录或任何失败）。 */
export async function readSessionClaims(): Promise<SessionClaims | null> {
  return (await readSessionClaimsDetailed()).claims;
}
