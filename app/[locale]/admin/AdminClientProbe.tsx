"use client";

import { useUser } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { monoStyle, mutedStyle } from "@/app/lib/styles";

/**
 * 客户端会话对照探针（诊断卡内嵌）。
 *
 * 客户端会话状态走 ClerkProvider + Frontend API（与 EdgeOne SSR 层完全
 * 独立的通道，todo `<Show>` 先例）。把它与门控卡的服务端判定并排展示：
 * - 客户端"已登录 · admin"而服务端报 no-cookie / verify-failed → 锁定
 *   EdgeOne SSR 层（cookie 透传 / JWKS 回源）问题；
 * - 客户端"无角色"而用户自认已是管理员 → Clerk publicMetadata 未注入
 *   session token 或令牌未刷新（重新登录可取新 claims）。
 * 纯展示组件，不构成任何访问边界。
 */
export function AdminClientProbe() {
  const t = useTranslations("admin");
  const { isLoaded, isSignedIn, user } = useUser();
  const role = user?.publicMetadata?.role;

  let state: string;
  if (!isLoaded) {
    state = t("probeLoading");
  } else if (!isSignedIn) {
    state = t("probeSignedOut");
  } else {
    state = t("probeSignedIn", { role: typeof role === "string" && role ? role : t("probeRoleNone") });
  }

  return (
    <p style={{ ...mutedStyle, margin: 0 }}>
      {t("probeLabel")}{" "}
      <span style={{ ...monoStyle, fontSize: "var(--fs-sm)" }}>{state}</span>
    </p>
  );
}
