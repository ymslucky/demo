import type { TableHTMLAttributes } from "react";
import { cx } from "./cx";

export type TableProps = TableHTMLAttributes<HTMLTableElement>;

export function Table({ className, ...rest }: TableProps) {
  return (
    <div className="nb-table-wrap">
      <table className={cx("nb-table", className)} {...rest} />
    </div>
  );
}
