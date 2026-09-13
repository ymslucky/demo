import type { ReactNode } from "react";

const defaultTray = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 8v13H3V8" />
    <path d="M1 3h22v5H1z" />
    <path d="M10 12h4" />
  </svg>
);

/**
 * 统一空态：描边圆托图标 + 标题（+ 可选描述 / 操作）。纯 token 样式，
 * 不含模糊与硬编码色值；compact 变体用于列内 / 卡片内的紧凑场景。
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={"empty-state" + (compact ? " empty-state--compact" : "")}>
      <div className="empty-state-icon" aria-hidden="true">
        {icon ?? defaultTray}
      </div>
      <p className="empty-state-title">{title}</p>
      {description ? <p className="empty-state-desc">{description}</p> : null}
      {action}
    </div>
  );
}
