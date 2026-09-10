import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge, Button, Card } from "../components/ui";
import { isAdminClaims } from "@/app/lib/rbac";
import { removeRole, setRole } from "./_actions";
import { SearchUsers } from "./SearchUsers";

/**
 * 管理后台（basic-rbac 教程模式）：服务端读取会话 claims.metadata.role，
 * 非管理员（含未登录）重定向回区域首页——安全边界在服务端，导航入口的
 * 隐藏只是展示层。页面随认证状态动态渲染（不做静态预览/HTML 缓存）。
 *
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

// 检索结果的渲染字段（Clerk UserResource 的结构子集，避免引入传递依赖类型）。
type AdminUserRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  primaryEmailAddressId: string | null;
  emailAddresses: { id: string; emailAddress: string }[];
  publicMetadata: { role?: string | null };
};

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

  const roleLabel = (role: string | null | undefined): string =>
    role === "admin" ? t("roleAdmin") : role === "moderator" ? t("roleModerator") : t("roleNone");

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
                      <Badge>{roleLabel(user.publicMetadata.role)}</Badge>
                    </td>
                    <td style={tdStyle}>
                      <div className="tool-row" style={{ flexWrap: "wrap" }}>
                        <form action={setRole}>
                          <input type="hidden" name="id" value={user.id} />
                          <input type="hidden" name="role" value="admin" />
                          <Button type="submit" variant="primary" size="sm" disabled={user.publicMetadata.role === "admin"}>
                            {t("makeAdmin")}
                          </Button>
                        </form>
                        <form action={setRole}>
                          <input type="hidden" name="id" value={user.id} />
                          <input type="hidden" name="role" value="moderator" />
                          <Button type="submit" size="sm" disabled={user.publicMetadata.role === "moderator"}>
                            {t("makeModerator")}
                          </Button>
                        </form>
                        <form action={removeRole}>
                          <input type="hidden" name="id" value={user.id} />
                          <Button type="submit" size="sm" disabled={user.publicMetadata.role == null}>
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
      </Card>
    </section>
  );
}
