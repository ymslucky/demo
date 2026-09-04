import type { HTMLAttributes } from "react";
import { cx } from "../../components/ui";

/**
 * Tool shell primitives (app/[locale]/tools/components/ToolShell.tsx).
 * They wrap the existing .tool-body / .tool-actions / .tool-result
 * classes so the six tools share one structural vocabulary.
 */

/** Column layout shell for a tool body (input + actions + result). */
export function ToolShell({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("tool-body", className)} {...rest} />;
}

/** Horizontal action row holding tool buttons. */
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

/** Live-region result box; renders nothing while the content is empty. */
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
