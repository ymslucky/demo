import type { HTMLAttributes } from "react";
import { cx } from "../../components/ui";

/**
 * 工具外壳基础组件（app/[locale]/tools/components/ToolShell.tsx）。
 * 它们包装现有的 .tool-body / .tool-actions / .tool-result
 * 类名，让六个工具共用同一套结构词汇。
 */

/** 工具主体的纵向布局外壳（输入 + 操作 + 结果）。 */
export function ToolShell({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("tool-body", className)} {...rest} />;
}

/** 水平排列、容纳工具按钮的操作行。 */
export function ToolActions({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("tool-actions", className)} {...rest} />;
}

export type ToolResultTone = "ok" | "err";

export type ToolResultProps = HTMLAttributes<HTMLDivElement> & {
  tone?: ToolResultTone;
};

/** live region 结果框；内容为空时不渲染任何节点。 */
export function ToolResult({
  tone = "ok",
  children,
  className,
  ...rest
}: ToolResultProps) {
  if (
    children === null ||
    children === undefined ||
    children === "" ||
    children === false
  ) {
    return null;
  }
  return (
    <div
      className={cx("tool-result", `tool-result--${tone}`, className)}
      aria-live="polite"
      {...rest}
    >
      {children}
    </div>
  );
}
