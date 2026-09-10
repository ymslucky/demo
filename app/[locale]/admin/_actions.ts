"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { isAdminClaims } from "@/app/lib/rbac";

/**
 * 管理后台 server actions：调整用户角色（写入 publicMetadata.role）。
 *
 * 安全设计：
 * - 每次调用都用会话 claims 重新校验管理员身份（UI 隐藏不构成边界）；
 * - 角色值走白名单（admin / moderator），拒绝任意 metadata 注入；
 * - 未通过校验静默不执行；Clerk Backend 调用失败（如部署环境缺
 *   CLERK_SECRET_KEY）静默返回，页面重取后仍显示真实角色，不抛 500。
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
  try {
    const client = await clerkClient();
    await client.users.updateUserMetadata(id, { publicMetadata: { role } });
  } catch {
    // Backend API 不可用：不执行写入（页面重取后展示真实状态）。
  }
}

export async function removeRole(formData: FormData): Promise<void> {
  const { sessionClaims } = await auth();
  if (!isAdminClaims(sessionClaims)) return;
  const id = inputText(formData, "id");
  if (!id) return;
  try {
    const client = await clerkClient();
    await client.users.updateUserMetadata(id, { publicMetadata: { role: null } });
  } catch {
    // Backend API 不可用：不执行写入（页面重取后展示真实状态）。
  }
}
