/**
 * Neo-Brutalism 共享内联样式（TS 常量，非全局 CSS 类——不产生 e2e 同步义务）。
 *
 * DRY：此前 card / muted / mono / control / 表格单元格样式在 code-sandbox
 * 三组件与 admin 页面各自复制，单点修改会遗漏。此处只收编跨页面复用的
 * 基础样式；组件特有样式（终端反色、队列行、状态徽章等）仍留在各自文件。
 * 需要变体时在使用处展开覆盖（如 { ...cardStyle, minHeight: 0 }），
 * 不做参数化工厂——保持简单。
 */

import type { CSSProperties } from "react";

/** 卡片基底：surface 底 + 3px 边框 + 硬阴影（.card 全局类的内联等价物）。 */
export const cardStyle: CSSProperties = {
  background: "var(--color-surface)",
  border: "3px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--shadow-sm)",
  padding: "var(--space-lg)",
};

/** 弱化说明文字。 */
export const mutedStyle: CSSProperties = {
  fontSize: "var(--fs-sm)",
  color: "var(--color-text-muted)",
};

/** 等宽字体。 */
export const monoStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
};

/**
 * 工具条/表单输入控件基底。原生 input/select/textarea 不继承字体，
 * fontFamily 必须显式声明。
 */
export const controlStyle: CSSProperties = {
  fontFamily: "inherit",
  fontSize: "var(--fs-sm)",
  padding: "0.35rem 0.5rem",
  border: "3px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
};

/** 表格表头单元格（配 3px 下边框 + tint 底）。 */
export const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "0.5rem 0.6rem",
  borderBottom: "3px solid var(--color-border)",
  background: "var(--color-tint)",
  whiteSpace: "nowrap",
};

/** 表格数据单元格（2px 下边框 + 顶部对齐 + 长词断行）。 */
export const tdStyle: CSSProperties = {
  padding: "0.45rem 0.6rem",
  borderBottom: "2px solid var(--color-border)",
  verticalAlign: "top",
  wordBreak: "break-all",
};
