"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Input } from "../components/ui";

/**
 * 管理后台用户搜索框：提交后把关键词写入 ?search= 查询参数，由服务端
 * 页面据此调用 Clerk Backend API 检索用户（教程 SearchUsers 模式）。
 * 样式复用工具页的 .tool-row / .tool-label / .tool-input 全局类。
 */

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
      className="tool-row"
      role="search"
    >
      <label htmlFor="admin-user-search" className="tool-label" style={{ flexShrink: 0 }}>
        {t("searchLabel")}
      </label>
      <Input
        id="admin-user-search"
        name="search"
        type="search"
        placeholder={t("searchPlaceholder")}
        aria-label={t("searchLabel")}
      />
      <Button type="submit" variant="primary" style={{ flexShrink: 0 }}>
        {t("searchSubmit")}
      </Button>
    </form>
  );
}
