"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "../components/ui";

/**
 * 管理后台用户搜索框：提交后把关键词写入 ?search= 查询参数，由服务端
 * 页面据此调用 Clerk Backend API 检索用户（教程 SearchUsers 模式）。
 */

const mutedStyle = {
  fontSize: "var(--fs-sm)",
  color: "var(--color-text-muted)",
} as const;

// 原生 input 不继承字体，必须显式 fontFamily: "inherit"。
const controlStyle = {
  fontFamily: "inherit",
  fontSize: "var(--fs-sm)",
  padding: "0.35rem 0.5rem",
  border: "3px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
} as const;

export function SearchUsers() {
  const t = useTranslations("admin");
  const router = useRouter();
  const pathname = usePathname();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const term = String(new FormData(event.currentTarget).get("search") ?? "").trim();
        router.push(term ? `${pathname}?search=${encodeURIComponent(term)}` : pathname);
      }}
      style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap", alignItems: "center" }}
      role="search"
    >
      <label htmlFor="admin-user-search" style={{ ...mutedStyle, fontWeight: 800 }}>
        {t("searchLabel")}
      </label>
      <input
        id="admin-user-search"
        name="search"
        type="search"
        placeholder={t("searchPlaceholder")}
        aria-label={t("searchLabel")}
        style={{ ...controlStyle, minWidth: 220 }}
      />
      <Button type="submit">{t("searchSubmit")}</Button>
    </form>
  );
}
