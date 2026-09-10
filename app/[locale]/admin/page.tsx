import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Button } from "../components/ui";
import { isAdminClaims } from "@/app/lib/rbac";
import { removeRole, setRole } from "./_actions";
import { SearchUsers } from "./SearchUsers";

/**
 * 管理后台（basic-rbac 教程模式）：服务端读取会话 claims.metadata.role，
 * 非管理员（含未登录）重定向回区域首页——安全边界在服务端，导航入口的
 * 隐藏只是展示层。页面随认证状态动态渲染（不做静态预览/HTML 缓存）。
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

// 与工具页同族的 Neo-Brutalism 卡片（内联样式，不新增全局容器类）。
const cardStyle = {
  background: "var(--color-surface)",
  border: "3px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--shadow-sm)",
  padding: "var(--space-lg)",
  display: "grid",
  gap: "var(--space-sm)",
} as const;

const mutedStyle = {
  fontSize: "var(--fs-sm)",
  color: "var(--color-text-muted)",
} as const;

const monoStyle = {
  fontFamily: "var(--font-mono)",
} as const;

const thStyle = {
  textAlign: "left" as const,
  padding: "0.5rem 0.6rem",
  borderBottom: "3px solid var(--color-border)",
  background: "var(--color-tint)",
  whiteSpace: "nowrap" as const,
} as const;

const tdStyle = {
  padding: "0.45rem 0.6rem",
  borderBottom: "2px solid var(--color-border)",
  verticalAlign: "top" as const,
  wordBreak: "break-all" as const,
} as const;

const roleBadgeStyle = {
  display: "inline-block",
  border: "2px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  padding: "0.1rem 0.5rem",
  fontSize: "var(--fs-xs)",
  fontWeight: 800,
  background: "var(--color-tint-strong)",
  whiteSpace: "nowrap",
} as const;

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

  // 门控：角色来自会话 claims（session token 定制注入）；未配置定制或
  // 角色不匹配一律重定向（fail-closed）。
  const { userId, sessionClaims } = await auth();
  if (!userId || !isAdminClaims(sessionClaims)) {
    redirect(`/${locale}`);
  }

  const query = ((await searchParams).search ?? "").trim();
  const client = await clerkClient();
  const users = query ? (await client.users.getUserList({ query })).data : [];

  const roleLabel = (role: unknown): string =>
    role === "admin" ? t("roleAdmin") : role === "moderator" ? t("roleModerator") : t("roleNone");

  return (
    <section style={{ display: "grid", gap: "var(--space-md)" }} aria-label={t("title")}>
      <div style={{ display: "grid", gap: "var(--space-xs)" }}>
        <h1 style={{ margin: 0, fontSize: "var(--fs-2xl)" }}>{t("title")}</h1>
        <p style={{ ...mutedStyle, margin: 0 }}>{t("subtitle")}</p>
      </div>

      {/* 当前管理员 */}
      <section style={cardStyle} aria-label={t("currentCard")}>
        <h2 style={{ margin: 0, fontSize: "var(--fs-xl)" }}>{t("currentCard")}</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-md)" }}>
          <div>
            <div style={mutedStyle}>{t("userIdLabel")}</div>
            <div style={{ ...monoStyle, fontSize: "var(--fs-sm)", wordBreak: "break-all" }}>
              {userId}
            </div>
          </div>
          <div>
            <div style={mutedStyle}>{t("roleLabel")}</div>
            <div>
              <span style={roleBadgeStyle}>{t("roleAdmin")}</span>
            </div>
          </div>
        </div>
      </section>

      {/* 沙箱工具限制策略 */}
      <section style={cardStyle} aria-label={t("policyTitle")}>
        <h2 style={{ margin: 0, fontSize: "var(--fs-xl)" }}>{t("policyTitle")}</h2>
        <ul style={{ margin: 0, paddingLeft: "1.2rem", display: "grid", gap: "0.25rem" }}>
          <li>{t("policyRun", { count: 10 })}</li>
          <li>{t("policyBrowser", { count: 60 })}</li>
          <li>{t("policyAdmin")}</li>
        </ul>
        <p style={{ ...mutedStyle, margin: 0 }}>{t("policyConfigHint")}</p>
        <p style={{ ...mutedStyle, margin: 0 }}>{t("tokenHint")}</p>
      </section>

      {/* 用户角色管理 */}
      <section style={cardStyle} aria-label={t("usersTitle")}>
        <h2 style={{ margin: 0, fontSize: "var(--fs-xl)" }}>{t("usersTitle")}</h2>
        <SearchUsers />
        {query === "" ? (
          <p style={{ ...mutedStyle, margin: 0 }}>{t("noQuery")}</p>
        ) : users.length === 0 ? (
          <p style={{ ...mutedStyle, margin: 0 }}>{t("noUsers")}</p>
        ) : (
          <div style={{ overflowX: "auto", border: "3px solid var(--color-border)", borderRadius: "var(--radius-sm)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-sm)", minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t("colUser")}</th>
                  <th style={thStyle}>{t("colEmail")}</th>
                  <th style={thStyle}>{t("colRole")}</th>
                  <th style={thStyle}>{t("colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 700 }}>
                        {[user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || user.id}
                      </div>
                      <div style={{ ...monoStyle, ...mutedStyle }}>{user.id}</div>
                    </td>
                    <td style={tdStyle}>
                      {user.emailAddresses.find((email) => email.id === user.primaryEmailAddressId)
                        ?.emailAddress ?? "—"}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                      <span style={roleBadgeStyle}>{roleLabel(user.publicMetadata.role)}</span>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>
                        <form action={setRole}>
                          <input type="hidden" name="id" value={user.id} />
                          <input type="hidden" name="role" value="admin" />
                          <Button size="sm" disabled={user.publicMetadata.role === "admin"}>
                            {t("makeAdmin")}
                          </Button>
                        </form>
                        <form action={setRole}>
                          <input type="hidden" name="id" value={user.id} />
                          <input type="hidden" name="role" value="moderator" />
                          <Button size="sm" disabled={user.publicMetadata.role === "moderator"}>
                            {t("makeModerator")}
                          </Button>
                        </form>
                        <form action={removeRole}>
                          <input type="hidden" name="id" value={user.id} />
                          <Button size="sm" disabled={user.publicMetadata.role === undefined}>
                            {t("removeRole")}
                          </Button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
