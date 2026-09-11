import { readSessionClaimsDetailed, type SessionClaims } from "./session";

/**
 * 服务端 RBAC 判定（Next.js 层共享）。角色来自会话 claims.metadata.role
 * （Clerk session token 定制注入，见 types/globals.d.ts）。
 *
 * 三级 API，按调用方的失败语义取用：
 * - isAdminClaims：已有 claims 时的纯判定；
 * - readAdminClaims：静默门控（server actions——失败即拒绝，不解释）；
 * - readAdminAccess：带失败原因的门控（admin 页面——区分"环境未配置"
 *   （如缺 CLERK_SECRET_KEY，应展示配置指引）与"无权限"（应重定向）。
 * UI 隐藏不构成边界，真正的门控在各调用点。
 */
export const ADMIN_ROLE = "admin";

/** 非管理员访问的失败语义：no-session 含未登录与验签失败，no-secret-key 为环境缺配置。 */
export type AdminAccess =
  | { ok: true; claims: SessionClaims }
  | { ok: false; reason: "not-admin" | "no-session" | "no-secret-key" };

export function isAdminClaims(claims: CustomJwtSessionClaims | null | undefined): boolean {
  return claims?.metadata?.role === ADMIN_ROLE;
}

export async function readAdminClaims(): Promise<SessionClaims | null> {
  const claims = await readSessionClaimsDetailed();
  return isAdminClaims(claims.claims) ? claims.claims : null;
}

export async function readAdminAccess(): Promise<AdminAccess> {
  const { claims, reason } = await readSessionClaimsDetailed();
  if (reason === "no-secret-key") return { ok: false, reason: "no-secret-key" };
  if (!claims || reason) return { ok: false, reason: "no-session" };
  return isAdminClaims(claims) ? { ok: true, claims } : { ok: false, reason: "not-admin" };
}
