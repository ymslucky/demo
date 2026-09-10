"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { isAdminClaims } from "@/app/lib/rbac";

/**
 * 管理后台 server actions：调整用户角色（写入 publicMetadata.role）。
 *
 * 安全设计：
 * - 每次调用都用会话 claims 重新校验管理员身份（UI 隐藏不构成边界）；
 * - 角色值走白名单（admin / moderator），拒绝任意 metadata 注入；
 * - 未通过校验静默不执行（页面提交后自动重取最新角色）。
 */

function inputText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function setRole(formData: FormData): Promise<void> {
  const { sessionClaims } = await auth();
  if (!isAdminClaims(sessionClaims)) return;
  const id = inputText(formData, "id");
  const role = inputText(formData, "role");
  if (!id || (role !== "admin" && role !== "moderator")) return;
  const client = await clerkClient();
  await client.users.updateUserMetadata(id, { publicMetadata: { role } });
}

export async function removeRole(formData: FormData): Promise<void> {
  const { sessionClaims } = await auth();
  if (!isAdminClaims(sessionClaims)) return;
  const id = inputText(formData, "id");
  if (!id) return;
  const client = await clerkClient();
  await client.users.updateUserMetadata(id, { publicMetadata: { role: null } });
}
