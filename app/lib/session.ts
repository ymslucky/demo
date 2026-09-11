import { cookies } from "next/headers";
import { verifyToken } from "@clerk/nextjs/server";

/**
 * Next.js 服务端会话读取（不依赖 clerkMiddleware 的 auth()）。
 *
 * 背景（EdgeOne Pages 生产限制）：适配器不透传 proxy.ts 中 clerkMiddleware
 * 的请求装饰——SSR 页面 / server action 里调用 auth() 会抛
 * "Clerk can't detect usage of clerkMiddleware()"（线上 500；本地 next dev
 * 正常，纯环境差异）。改用 Clerk 官方手动验签路径：读取 __session cookie，
 * 交由 @clerk/backend 的 verifyToken 完成（签名 + exp/nbf + clockSkewInMs
 * + 可选 authorizedParties；JWKS 从 SK 对应实例的官方 Backend API 回源并
 * 模块级缓存——本文件不自己解析 JWT）。
 *
 * 安全模型：verifyToken 的 JWKS 回源由 CLERK_SECRET_KEY 决定，签名验证
 * 天然绑定到 SK 所属的 Clerk 实例——其他实例签发的 token 必然验签失败。
 * 因此 issuer / azp 白名单在这里是可选的纵深加固而非必需关卡（与边缘函数
 * 不同：那边的 JWKS URL 从 token iss 构造，必须钉死白名单）：
 * - CLERK_ISSUER 设置时才校验 iss（多实例并存、想显式钉死时使用）；
 * - CLERK_AZP_ORIGINS（逗号分隔 origin）设置时才校验 azp。
 * 默认不钉死，dev 实例（*.clerk.accounts.dev）本地开发与生产实例部署
 * 开箱即用。
 *
 * 诊断：readSessionClaimsDetailed 返回失败原因（no-cookie / no-secret-key /
 * verify-failed / issuer-mismatch），供门控页区分"环境未配置"与"无权限"。
 * 两种失败都一律不返回 claims（fail-closed），绝不抛 500。
 */

const SESSION_COOKIE = "__session";

export type SessionClaims = CustomJwtSessionClaims & Record<string, unknown>;

export type SessionFailureReason =
  | "no-cookie"
  | "no-secret-key"
  | "verify-failed"
  | "issuer-mismatch";

export type SessionResult = {
  claims: SessionClaims | null;
  reason: SessionFailureReason | null;
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
 * 读取并验签当前请求的 Clerk 会话 claims；未登录 / 环境缺 CLERK_SECRET_KEY /
 * 验签失败一律 claims: null 并附 reason（fail-closed）。服务端组件与
 * server action 均可调用（不依赖 clerkMiddleware）。
 */
export async function readSessionClaimsDetailed(): Promise<SessionResult> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return { claims: null, reason: "no-cookie" };

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return { claims: null, reason: "no-secret-key" };

  try {
    const { data, errors } = await verifyToken(token, {
      secretKey,
      // 可选加固：CLERK_AZP_ORIGINS 显式设置时才校验 azp（默认信任 Clerk）。
      authorizedParties: commaList(process.env.CLERK_AZP_ORIGINS) ?? undefined,
    });
    // verifyToken 的返回元素类型过宽（{}），收窄后再读字段。
    const claims = (data ?? null) as SessionClaims | null;
    if (errors || !claims) return { claims: null, reason: "verify-failed" };

    // 可选加固：CLERK_ISSUER 显式设置时才钉死 issuer。
    const expectedIssuer = process.env.CLERK_ISSUER;
    if (expectedIssuer && normalizeIssuer(claims.iss) !== normalizeIssuer(expectedIssuer)) {
      return { claims: null, reason: "issuer-mismatch" };
    }
    return { claims, reason: null };
  } catch {
    return { claims: null, reason: "verify-failed" };
  }
}

/** 便捷封装：只要 claims（null = 未登录或任何失败）。 */
export async function readSessionClaims(): Promise<SessionClaims | null> {
  return (await readSessionClaimsDetailed()).claims;
}
