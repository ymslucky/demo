import type { HTMLAttributes } from "react";
import { cx } from "./cx";

export type CardElement = "div" | "article" | "section" | "aside";

export type CardProps = HTMLAttributes<HTMLElement> & {
  as?: CardElement;
};

export function Card({ as: Tag = "div", className, ...rest }: CardProps) {
  return <Tag className={cx("card", className)} {...rest} />;
}
