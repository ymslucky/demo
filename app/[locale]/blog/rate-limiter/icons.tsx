/**
 * 令牌桶演示专用的内联 SVG 图标（零依赖，替代 lucide-react）。
 * 风格与 nav/icons.tsx 保持一致：stroke 描边、currentColor、
 * aria-hidden（纯装饰，伴随可读文本出现）。
 */

import type { CSSProperties, ReactNode } from "react";

interface IconProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/** 图标共用的 <svg> 外壳：lucide 同款 24 网格与描边参数 */
function Svg({
  size = 24,
  className,
  style,
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function ZapIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </Svg>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <polygon points="6 3 20 12 6 21 6 3" />
    </Svg>
  );
}

export function Settings2Icon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 7h-9" />
      <path d="M14 17H5" />
      <circle cx="17" cy="17" r="3" />
      <circle cx="7" cy="7" r="3" />
    </Svg>
  );
}

export function Trash2Icon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </Svg>
  );
}
