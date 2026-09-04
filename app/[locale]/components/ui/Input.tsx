import type { InputHTMLAttributes } from "react";
import { cx } from "./cx";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...rest }: InputProps) {
  return <input className={cx("tool-input", className)} {...rest} />;
}
