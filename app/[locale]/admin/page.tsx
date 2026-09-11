import type { Metadata } from "next";
import { clerkClient } from "@clerk/nextjs/server";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { Badge, Card } from "../components/ui";
import { monoStyle, mutedStyle } from "@/app/lib/styles";
import { readAdminClaims } from "@/app/lib/rbac";
import { AdminUserTable, type AdminUserRow } from "./UserTable";
import { SearchUsers } from "./SearchUsers";

/**
 * 管理后台（basic-rbac 教程模式）：门控 + 三张信息卡 + 用户角色管理。
 *
 * 职责边界：本页面只做门控与检索编排——角色表格在 UserTable、动作在
 * _actions、会话验签在 app/lib/session、角色判定在 app/lib/rbac。
 *
 * 会话读取走 readAdminClaims（直接验签 __session cookie）——EdgeOne
 * 适配器不透传 clerkMiddleware 装饰，auth() 在生产 SSR 不可用（500）。
 * 用户检索只在带 ?search= 时初始化 clerkClient（需要部署环境
 * CLERK_SECRET_KEY）；初始化/请求失败降级为可读文案而不是 500。
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  // 管理后台不进搜索引擎索引。
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function AdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ search?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin");

  // 门控：角色来自已验签的会话 claims（session token 定制注入）；未配置
  // 定制、未登录或角色不匹配一律重定向（fail-closed）。
  const claims = await readAdminClaims();
  if (!claims) {
    redirect({ href: "/", locale });
  }
  // redirect 不参与 TS 窄化（next-intl 签名非 never），可空链兜底。
  const userId = typeof claims?.sub === "string" ? claims.sub : "";

  const query = ((await searchParams).search ?? "").trim();
  let users: AdminUserRow[] = [];
  let usersError = false;
  if (query) {
    try {
      const client = await clerkClient();
      users = (await client.users.getUserList({ query })).data;
    } catch {
      // 缺 CLERK_SECRET_KEY / Backend API 不可达：降级为文案，不炸页面。
      usersError = true;
    }
  }

  return (
    <section style={{ display: "grid", gap: "var(--space-md)" }} aria-label={t("title")}>
      <div style={{ display: "grid", gap: "var(--space-xs)" }}>
        <h1 style={{ margin: 0, fontSize: "var(--fs-2xl)" }}>{t("title")}</h1>
        <p style={{ ...mutedStyle, margin: 0 }}>{t("subtitle")}</p>
      </div>

      {/* 当前管理员 */}
      <Card as="section" aria-label={t("currentCard")}>
        <h2 style={{ margin: 0, fontSize: "var(--fs-xl)" }}>{t("currentCard")}</h2>
        <div className="tool-row" style={{ flexWrap: "wrap", gap: "var(--space-md)" }}>
          <div>
            <div className="tool-label">{t("userIdLabel")}</div>
            <div style={{ ...monoStyle, fontSize: "var(--fs-sm)", wordBreak: "break-all" }}>
              {userId}
            </div>
          </div>
          <div>
            <div className="tool-label">{t("roleLabel")}</div>
            <div>
              <Badge>{t("roleAdmin")}</Badge>
            </div>
          </div>
        </div>
      </Card>

      {/* 沙箱工具限制策略 */}
      <Card as="section" aria-label={t("policyTitle")}>
        <h2 style={{ margin: 0, fontSize: "var(--fs-xl)" }}>{t("policyTitle")}</h2>
        <ul style={{ margin: 0, paddingLeft: "1.2rem", display: "grid", gap: "0.25rem" }}>
          <li>{t("policyRun", { count: 10 })}</li>
          <li>{t("policyBrowser", { count: 60 })}</li>
          <li>{t("policyAdmin")}</li>
        </ul>
        <p style={{ ...mutedStyle, margin: 0 }}>{t("policyConfigHint")}</p>
        <p style={{ ...mutedStyle, margin: 0 }}>{t("tokenHint")}</p>
      </Card>

      {/* 用户角色管理 */}
      <Card as="section" aria-label={t("usersTitle")}>
        <h2 style={{ margin: 0, fontSize: "var(--fs-xl)" }}>{t("usersTitle")}</h2>
        <SearchUsers />
        {query === "" ? (
          <p style={{ ...mutedStyle, margin: 0 }}>{t("noQuery")}</p>
        ) : usersError ? (
          <p style={{ ...mutedStyle, margin: 0 }}>{t("usersUnavailable")}</p>
        ) : users.length === 0 ? (
          <p style={{ ...mutedStyle, margin: 0 }}>{t("noUsers")}</p>
        ) : (
          <AdminUserTable users={users} />
        )}
      </Card>
    </section>
  );
}
