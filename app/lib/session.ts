import { cookies } from "next/headers";
import { verifyToken } from "@clerk/nextjs/server";

/**
 * Next.js 服务端会话读取（不依赖 clerkMiddleware 的 auth()）。
 *
 * 背景（EdgeOne Pages 生产限制）：适配器不透传 proxy.ts 中 clerkMiddleware
 * 的请求装饰——SSR 页面 / server action 里调用 auth() 会抛
 * "Clerk can't detect usage of clerkMiddleware()"（线上 500；本地 next dev
 * 正常，纯环境差异）。改用 Clerk 官方的手动验签路径：直接读取 __session
 * cookie，交由 @clerk/backend 的 verifyToken 完成（官方实现：签名 + exp/nbf
 * + clockSkewInMs=5000 + authorizedParties(azp)，JWKS 从官方 Backend API
 * 回源并模块级缓存——本文件不自己解析 JWT）。
 *
 * 部署要求：环境需配置 CLERK_SECRET_KEY（verifyToken 的 JWKS 回源强制；
 * 用户搜索 / 角色管理的 clerkClient 同样需要）。缺失时一律视为未登录
 * （fail-closed）——管理后台与角色写入全部关闭，但不产生 500。
 *
 * 与边缘层（functions/api/todo.js 八步清单）的强度对齐：
 * - issuer 钉死：verifyToken 不校验 iss（JWKS/PEM 已绑定本实例，伪造实例
 *   的签名过不了验签），这里仍显式校验 iss 白名单保持同强度；
 *   默认 `https://clerk.<SITE_DOMAIN apex>`，可用 CLERK_ISSUER 覆盖
 *   （本地开发指向 Clerk Dashboard 的 dev 实例域）。
 * - azp 白名单：authorizedParties（azp 缺失放行，同官方语义）；
 *   默认 apex 及 www 变体，可用 CLERK_AZP_ORIGINS（逗号分隔）覆盖。
 */

const SESSION_COOKIE = "__session";
const DEFAULT_SITE_APEX = "rdom.cn";

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

function commaList(raw: string | undefined, fallback: string[]): string[] {
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  const items = raw.split(",").map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : fallback;
}

/**
 * 读取并验签当前请求的 Clerk 会话 claims；未登录 / 验签失败 / 环境缺
 * CLERK_SECRET_KEY 一律返回 null（fail-closed）。服务端组件与 server
 * action 均可调用（不依赖 clerkMiddleware）。
 */
export async function readSessionClaims(): Promise<SessionClaims | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return null;

  const apex = siteApex(process.env.SITE_DOMAIN) ?? DEFAULT_SITE_APEX;
  const issuer = process.env.CLERK_ISSUER || `https://clerk.${apex}`;
  const authorizedParties = commaList(
    process.env.CLERK_AZP_ORIGINS,
    [`https://${apex}`, `https://www.${apex}`],
  );

  try {
    const { data, errors } = await verifyToken(token, { secretKey, authorizedParties });
    // verifyToken 的返回元素类型过宽（{}），收窄后再读 iss。
    const claims = (data ?? null) as SessionClaims | null;
    if (errors || !claims) return null;
    if (normalizeIssuer(claims.iss) !== normalizeIssuer(issuer)) return null;
    return claims;
  } catch {
    return null;
  }
}
