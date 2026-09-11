import { readSessionClaims, type SessionClaims } from "./session";

/**
 * 服务端 RBAC 判定（Next.js 层共享）。角色来自会话 claims.metadata.role
 * （Clerk session token 定制注入，见 types/globals.d.ts）。
 *
 * 两级 API，按需取用：
 * - isAdminClaims：已有 claims 时的纯判定；
 * - readAdminClaims：读取 + 验签 + 判定一步到位（admin 页面与 server
 *   actions 的门控入口），非管理员返回 null——调用方自行决定重定向或
 *   静默拒绝。UI 隐藏不构成边界，真正的门控在各调用点。
 */
export const ADMIN_ROLE = "admin";

export function isAdminClaims(claims: CustomJwtSessionClaims | null | undefined): boolean {
  return claims?.metadata?.role === ADMIN_ROLE;
}

export async function readAdminClaims(): Promise<SessionClaims | null> {
  const claims = await readSessionClaims();
  return isAdminClaims(claims) ? claims : null;
}
