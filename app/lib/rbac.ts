import {
  readSessionClaimsDetailed,
  type SessionClaims,
  type SessionFailureReason,
} from "./session";
// 角色常量单一真源在 shared/auth-core.js（agents 层 roleFromClaims 同源）。
import { ADMIN_ROLE } from "@lucky/auth-core";

/**
 * 服务端 RBAC 判定（Next.js 层共享）。角色来自会话 claims.metadata.role
 * （Clerk session token 定制注入，见 types/globals.d.ts）。
 *
 * 三级 API，按调用方的失败语义取用：
 * - isAdminClaims：已有 claims 时的纯判定；
 * - readAdminClaims：静默门控（server actions——失败即拒绝，不解释）；
 * - readAdminAccess：带失败原因的门控（admin 页面——所有失败态就地展示
 *   诊断卡而非静默重定向：环境缺密钥 → 配置指引；未登录 → 登录提示；
 *   验签失败 → reason + detail 诊断；已登录但非 admin → 无权限说明）。
 * UI 隐藏不构成边界，真正的门控在各调用点。
 */
export { ADMIN_ROLE };

/**
 * 非管理员访问的失败语义（每个失败态 reason 均为单一字面量——页面按
 * 判别联合收窄分支，联合型 reason 会破坏 TS 收窄）：
 * - no-key：环境无任何验签密钥材料（CLERK_SECRET_KEY / CLERK_JWT_PUBLIC_KEY 均缺）；
 * - no-session：会话层失败（sessionReason 细分 no-cookie / verify-failed /
 *   issuer-mismatch，detail 为 verifyToken 错误摘要——诊断卡数据源；
 *   input 为验签输入侧摘要——sk/pem 存在性与形态）；
 * - not-admin：会话有效但角色非 admin（保留 claims 供页面展示当前身份）。
 */
export type AdminAccess =
  | { ok: true; claims: SessionClaims }
  | {
      ok: false;
      reason: "no-key";
      sessionReason: SessionFailureReason;
      detail: string | null;
      input: string | null;
    }
  | {
      ok: false;
      reason: "no-session";
      sessionReason: SessionFailureReason;
      detail: string | null;
      input: string | null;
    }
  | {
      ok: false;
      reason: "not-admin";
      claims: SessionClaims;
      /** claims.metadata 的 JSON 快照——诊断卡展示，确诊模板是否生效。 */
      metadataSnapshot: string;
    };

export function isAdminClaims(claims: CustomJwtSessionClaims | null | undefined): boolean {
  return claims?.metadata?.role === ADMIN_ROLE;
}

export async function readAdminClaims(): Promise<SessionClaims | null> {
  const claims = await readSessionClaimsDetailed();
  return isAdminClaims(claims.claims) ? claims.claims : null;
}

export async function readAdminAccess(): Promise<AdminAccess> {
  const { claims, reason, detail, input } = await readSessionClaimsDetailed();
  if (reason === "no-key") {
    return { ok: false, reason: "no-key", sessionReason: reason, detail, input };
  }
  if (reason || !claims) {
    return {
      ok: false,
      reason: "no-session",
      sessionReason: reason ?? "verify-failed",
      detail,
      input,
    };
  }
  return isAdminClaims(claims)
    ? { ok: true, claims }
    : { ok: false, reason: "not-admin", claims, metadataSnapshot: JSON.stringify(claims.metadata ?? null) };
}
