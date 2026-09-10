/**
 * 服务端 RBAC 判定（Next.js 层共享）：角色来自会话 claims.metadata.role
 * （Clerk session token 定制注入，见 types/globals.d.ts）。真正的安全边界
 * 在各门控点（admin 页面 / server action 双重校验），UI 隐藏不构成边界。
 */
export const ADMIN_ROLE = "admin";

export function isAdminClaims(claims: CustomJwtSessionClaims | null | undefined): boolean {
  return claims?.metadata?.role === ADMIN_ROLE;
}
