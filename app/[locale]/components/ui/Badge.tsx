import type { HTMLAttributes } from "react";
import { cx } from "./cx";

export type BadgeProps = HTMLAttributes<HTMLSpanElement>;

export function Badge({ className, ...rest }: BadgeProps) {
  return <span className={cx("tag", className)} {...rest} />;
}
