/**
 * Pure utility functions for the tools page.
 *
 * Extracted from ToolsClient.tsx so they can be unit-tested in isolation
 * and reused without pulling in React.
 */

// ---------------------------------------------------------------------------
// Unit conversion
// ---------------------------------------------------------------------------

export interface UnitDef {
  label: string;
  factor: number;
  offset?: number;
}

export const unitData: Record<string, UnitDef[]> = {
  length: [
    { label: "米 (m)", factor: 1 },
    { label: "千米 (km)", factor: 1000 },
    { label: "厘米 (cm)", factor: 0.01 },
    { label: "毫米 (mm)", factor: 0.001 },
    { label: "英寸 (in)", factor: 0.0254 },
    { label: "英尺 (ft)", factor: 0.3048 },
    { label: "英里 (mi)", factor: 1609.344 },
  ],
  temperature: [
    { label: "摄氏度 (°C)", factor: 1, offset: 0 },
    { label: "华氏度 (°F)", factor: 5 / 9, offset: -32 * (5 / 9) },
    { label: "开尔文 (K)", factor: 1, offset: -273.15 },
  ],
  data: [
    { label: "字节 (B)", factor: 1 },
    { label: "千字节 (KB)", factor: 1024 },
    { label: "兆字节 (MB)", factor: 1024 ** 2 },
    { label: "吉字节 (GB)", factor: 1024 ** 3 },
    { label: "太字节 (TB)", factor: 1024 ** 4 },
  ],
};

/** Strip trailing zeros and unnecessary decimal point from a numeric string. */
function trimTrailingZeros(s: string): string {
  return s.replace(/\.?0+$/, "");
}

/**
 * Convert a value between two units within the same category.
 *
 * For temperature, the formula `celsius = val * factor + offset` is used
 * (the data's offset/factor are designed for this form). The previous
 * implementation used `(val + offset) * factor`, which produced incorrect
 * results for Fahrenheit conversions.
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
// Color helpers
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

/** Compute RGB and HSL display strings from a #RRGGBB hex value. */
export function getColorStrings(hex: string): ColorStrings {
  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  return {
    rgb: `rgb(${r}, ${g}, ${b})`,
    hsl: `hsl(${h}, ${s}%, ${l}%)`,
  };
}

// ---------------------------------------------------------------------------
// Base64 (Unicode-safe — replaces deprecated escape/unescape)
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
// Case conversion
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
