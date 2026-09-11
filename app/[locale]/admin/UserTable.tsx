import { useTranslations } from "next-intl";
import { Badge, Button } from "../components/ui";
import { monoStyle, mutedStyle, tdStyle, thStyle } from "@/app/lib/styles";
import { removeRole, setRole } from "./_actions";

/**
 * 管理后台用户表格（server component）：展示检索结果并内联角色操作表单。
 * 只负责展示与动作接线；检索与门控在 page.tsx。
 */

/** 渲染字段（Clerk UserResource 的结构子集，避免引入传递依赖类型）。 */
export type AdminUserRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  primaryEmailAddressId: string | null;
  emailAddresses: { id: string; emailAddress: string }[];
  publicMetadata: { role?: string | null };
};

export function AdminUserTable({ users }: { users: AdminUserRow[] }) {
  const t = useTranslations("admin");

  const roleLabel = (role: string | null | undefined): string =>
    role === "admin" ? t("roleAdmin") : role === "moderator" ? t("roleModerator") : t("roleNone");

  return (
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
  );
}
