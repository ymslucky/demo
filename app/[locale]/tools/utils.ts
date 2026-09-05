/**
 * 工具页所用的纯工具函数。
 *
 * 从 ToolsClient.tsx 中抽取出来，便于独立做单元测试，
 * 并在不引入 React 的前提下复用。
 *
 * `UnitDef.label` 保存的是一个翻译键（如 "m"、"km"），渲染时会在
 * `unit.<category>.<label>` 消息命名空间下解析，
 * 因此单位目录本身与语言环境无关。
 */

// ---------------------------------------------------------------------------
// 单位换算
// ---------------------------------------------------------------------------

export interface UnitDef {
  label: string;
  factor: number;
  offset?: number;
}

export const unitData: Record<string, UnitDef[]> = {
  length: [
    { label: "m", factor: 1 },
    { label: "km", factor: 1000 },
    { label: "cm", factor: 0.01 },
    { label: "mm", factor: 0.001 },
    { label: "in", factor: 0.0254 },
    { label: "ft", factor: 0.3048 },
    { label: "mi", factor: 1609.344 },
  ],
  temperature: [
    { label: "c", factor: 1, offset: 0 },
    { label: "f", factor: 5 / 9, offset: -32 * (5 / 9) },
    { label: "k", factor: 1, offset: -273.15 },
  ],
  data: [
    { label: "b", factor: 1 },
    { label: "kb", factor: 1024 },
    { label: "mb", factor: 1024 ** 2 },
    { label: "gb", factor: 1024 ** 3 },
    { label: "tb", factor: 1024 ** 4 },
  ],
};

/** 去掉数字字符串末尾多余的 0 和不必要的小数点。 */
function trimTrailingZeros(s: string): string {
  return s.replace(/\.?0+$/, "");
}

/**
 * 在同一类别内的两个单位之间换算数值。
 *
 * 温度采用公式 `celsius = val * factor + offset`
 * （数据中的 offset/factor 即按此形式设计）。旧实现使用的是
 * `(val + offset) * factor`，在华氏温度换算时会产生
 * 错误结果。
 */
export function convertUnit(
  category: string,
  fromIdx: number,
  toIdx: number,
  value: string,
): string {
  const val = parseFloat(value);
  if (isNaN(val)) return "";

  const units = unitData[category];
  const fromU = units[fromIdx];
  const toU = units[toIdx];
  if (!fromU || !toU) return "";

  if (category === "temperature") {
    const celsius = val * fromU.factor + (fromU.offset || 0);
    const result = (celsius - (toU.offset || 0)) / toU.factor;
    return trimTrailingZeros(result.toFixed(4));
  }

  const baseVal = val * fromU.factor;
  const result = baseVal / toU.factor;
  return trimTrailingZeros(result.toPrecision(10));
}

// ---------------------------------------------------------------------------
// 颜色辅助函数
// ---------------------------------------------------------------------------

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

export interface ColorStrings {
  rgb: string;
  hsl: string;
}

/** 由 #RRGGBB 十六进制值计算 RGB 与 HSL 显示字符串。 */
export function getColorStrings(hex: string): ColorStrings {
  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  return {
    rgb: `rgb(${r}, ${g}, ${b})`,
    hsl: `hsl(${h}, ${s}%, ${l}%)`,
  };
}

// ---------------------------------------------------------------------------
// Base64（Unicode 安全 — 替代已废弃的 escape/unescape）
// ---------------------------------------------------------------------------

export function encodeBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeBase64(b64: string): string {
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// ---------------------------------------------------------------------------
// Timezone formatting
// ---------------------------------------------------------------------------

/**
 * Format a timezone offset as `UTC±HH:MM`.
 *
 * Correctly handles 30/45-minute offsets (e.g. UTC+5:30 India, UTC+5:45 Nepal).
 */
export function formatTimezone(d: Date): string {
  const offset = d.getTimezoneOffset();
  const sign = offset <= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const h = String(Math.floor(abs / 60)).padStart(2, "0");
  const m = String(abs % 60).padStart(2, "0");
  return `UTC${sign}${h}:${m}`;
}

// ---------------------------------------------------------------------------
// 大小写转换
// ---------------------------------------------------------------------------

export type CaseMode = "upper" | "lower" | "title" | "camel" | "snake";

export function convertCase(mode: string, input: string): string {
  if (!input) return "";
  switch (mode) {
    case "upper":
      return input.toUpperCase();
    case "lower":
      return input.toLowerCase();
    case "title":
      return input.replace(
        /\w\S*/g,
        (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
      );
    case "camel": {
      const parts = input.toLowerCase().split(/[\s_-]+/).filter(Boolean);
      return parts
        .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
        .join("");
    }
    case "snake":
      return input.trim().toLowerCase().replace(/[\s-]+/g, "_");
    default:
      return input;
  }
}
