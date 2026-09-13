/**
 * shared/auth-core/providers.js —— 供应商适配层契约（换验证体系的预留）。
 *
 * 供应商特有参数在此收敛为配置对象契约（issuers / roleFromClaims /
 * apexFromIssuer 三方法）：换验证体系（如 Supabase Auth）= 新增一个
 * provider 对象实现同一契约，调用方换一行 import——验证核心
 * verifySessionDetailed 与上游门控层零改动（核心只吃 issuers / azpApex
 * 参数，不感知 provider，算法与供应商解耦）。
 *
 * Supabase Auth 形态示例（仅示意同契约的三方法，本期不实现，避免
 * 无法验证的死代码）：
 * export const supabaseProvider = {
 *   id: "supabase",
 *   // issuer 白名单：项目 URL 派生 + 显式覆盖（示意，不实现）
 *   issuers: (env) => [...],
 *   // claims → 标准化角色（Supabase 惯例取 app_metadata.role）
 *   roleFromClaims: (payload) => "...",
 *   // azp 判定基准派生：iss host → apex
 *   apexFromIssuer: (iss) => siteApex(iss) ?? "",
 * };
 */

import { deriveIssuers, roleFromClaims, siteApex } from "./predicates.js";

/**
 * azp 判定基准派生：iss host → apex，再剥离 Clerk 自定义实例惯例的
 * "clerk." 前缀。siteApex 返回 null（非法/空输入）时返回 ""。语义与
 * app/lib/session.ts JWKS 通道的既有派生
 * `(siteApex(issuer) ?? "").replace(/^clerk\./, "")` 完全一致。
 * @param {unknown} issuer 会话 JWT 的 iss
 * @returns {string}
 */
export function apexFromIssuer(issuer) {
  return (siteApex(issuer) ?? "").replace(/^clerk\./, "");
}

/**
 * Clerk provider 适配对象：把 Clerk 特有参数收敛为统一契约。
 * @type {{ id: "clerk", issuers: (env?: { siteDomain?: string, issuerOverride?: string }) => string[], roleFromClaims: typeof roleFromClaims, apexFromIssuer: typeof apexFromIssuer }}
 */
export const clerkProvider = {
  id: "clerk",
  // issuer 白名单派生：显式覆盖（CLERK_ISSUER）优先，否则按 clerk.<apex>
  // 惯例由 SITE_DOMAIN 派生，两者皆缺省退回默认 apex。
  issuers: ({ siteDomain, issuerOverride } = {}) =>
    deriveIssuers({ siteDomain, clerkIssuer: issuerOverride }),
  // claims → 标准化角色：payload.metadata.role（shared 既有实现）。
  roleFromClaims,
  // azp 判定基准派生：iss host → apex（剥 "clerk." 前缀）。
  apexFromIssuer,
};
