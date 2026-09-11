import type { Metadata } from "next";
import { clerkClient } from "@clerk/nextjs/server";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Badge, Card } from "../components/ui";
import { monoStyle, mutedStyle } from "@/app/lib/styles";
import { readAdminAccess } from "@/app/lib/rbac";
import { AdminUserTable, type AdminUserRow } from "./UserTable";
import { AdminClientProbe } from "./AdminClientProbe";
import { SearchUsers } from "./SearchUsers";

/**
 * 管理后台（basic-rbac 教程模式）：门控 + 三张信息卡 + 用户角色管理。
 *
 * 职责边界：本页面只做门控与检索编排——角色表格在 UserTable、动作在
 * _actions、会话验签在 app/lib/session、角色判定在 app/lib/rbac、客户端
 * 会话对照在 AdminClientProbe。
 *
 * 会话读取走 readAdminAccess（直接验签 __session cookie）——EdgeOne
 * 适配器不透传 clerkMiddleware 装饰，auth() 在生产 SSR 不可用（500）。
 *
 * 门控哲学：**失败态绝不静默重定向**（"一点击就跳首页"式不可见故障是
 * 本页的头号排障成本）。所有失败就地展示诊断卡，并排客户端对照探针：
 * - no-key → 环境配置指引（CLERK_SECRET_KEY / CLERK_JWT_PUBLIC_KEY）；
 * - no-session + no-cookie → 登录提示；
 * - no-session + 其他 → 服务端逐关诊断（reason + detail）+ 自愈提示；
 * - not-admin → 无权限说明（会话有效但角色不符）。
 * 用户检索只在带 ?search= 时初始化 clerkClient；失败降级为可读文案。
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

/** 失败态诊断卡公共外壳：标题 + 说明行 + 附加内容。 */
function GateCard({
  title,
  lines,
  children,
}: {
  title: string;
  lines: string[];
  children?: React.ReactNode;
}) {
  return (
    <Card as="section" aria-label={title} style={{ maxWidth: 720 }}>
      <h1 style={{ margin: 0, fontSize: "var(--fs-xl)" }}>{title}</h1>
      {lines.map((line) => (
        <p key={line} style={{ ...mutedStyle, margin: 0 }}>
          {line}
        </p>
      ))}
      {children}
    </Card>
  );
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

  const access = await readAdminAccess();
  if (!access.ok) {
    if (access.reason === "no-key") {
      return (
        <GateCard title={t("envMissingTitle")} lines={[t("envMissingDetail"), t("envMissingHint")]}>
          <AdminClientProbe />
        </GateCard>
      );
    }
    if (access.reason === "no-session") {
      // 服务端会话层失败，按细分原因分型展示；复合判断嵌套以保证
      // TS 判别联合在后续分支正确收窄为 not-admin。
      if (access.sessionReason === "no-cookie") {
        // 读不到会话 cookie：未登录，或 EdgeOne SSR 层 cookie 透传
        // 异常（由客户端探针对照判定——探针显示已登录即为适配器问题）。
        return (
          <GateCard title={t("gateSignedOutTitle")} lines={[t("gateSignedOutDetail")]}>
            <AdminClientProbe />
            <Link href="/" className="dock-auth-btn">
              {t("gateBackHome")}
            </Link>
          </GateCard>
        );
      }
      // 会话存在但服务端验签失败：就地展示逐关诊断（reason + detail），
      // 客户端探针用于对照锁定 EdgeOne SSR 层问题。
      return (
        <GateCard
          title={t("gateVerifyTitle")}
          lines={[t("gateVerifyDetail"), t("gateVerifyHintJwks"), t("gateVerifyHintIssuer")]}
        >
          <p style={{ margin: 0, display: "flex", gap: "var(--space-xs)", alignItems: "center", flexWrap: "wrap" }}>
            <span className="tool-label">{t("gateVerifyReasonLabel")}</span>
            <Badge>{access.sessionReason ?? "verify-failed"}</Badge>
          </p>
          <div>
            <div className="tool-label">{t("gateVerifyKeyMaterialLabel")}</div>
            <div style={{ ...monoStyle, fontSize: "var(--fs-sm)", wordBreak: "break-all" }}>
              {access.input || "—"}
            </div>
          </div>
          <div>
            <div className="tool-label">{t("gateVerifyDetailLabel")}</div>
            <div style={{ ...monoStyle, fontSize: "var(--fs-sm)", wordBreak: "break-all" }}>
              {access.detail || t("gateVerifyDetailNone")}
            </div>
          </div>
          <AdminClientProbe />
        </GateCard>
      );
    }
    // not-admin：会话有效但角色不符——展示身份，附客户端对照
    // （publicMetadata 未注入 / 令牌未刷新时客户端同样显示无角色）。
    const seenUserId = typeof access.claims.sub === "string" ? access.claims.sub : "";
    return (
      <GateCard
        title={t("gateNotAdminTitle")}
        lines={[t("gateNotAdminDetail", { userId: seenUserId })]}
      >
        <AdminClientProbe />
        <Link href="/" className="dock-auth-btn">
          {t("gateBackHome")}
        </Link>
      </GateCard>
    );
  }
  const userId = typeof access.claims.sub === "string" ? access.claims.sub : "";

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
