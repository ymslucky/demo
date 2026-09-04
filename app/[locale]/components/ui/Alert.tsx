import type { HTMLAttributes } from "react";
import { cx } from "./cx";

export type AlertVariant = "info" | "err";

export type AlertProps = HTMLAttributes<HTMLDivElement> & {
  variant?: AlertVariant;
};

export function Alert({
  variant = "info",
  className,
  ...rest
}: AlertProps) {
  return (
    <div
      className={cx("nb-alert", `nb-alert--${variant}`, className)}
      {...rest}
    />
  );
}
