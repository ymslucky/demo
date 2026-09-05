/**
 * HTTP 检查工具的纯辅助函数。
 *
 * 从页面与 API 路由中抽取出来，便于单元测试和复用。
 * 输出名称（browser / OS 等）保持其规范的英文
 * 形式，不纳入 i18n。
 */

// ---------------------------------------------------------------------------
// 客户端 IP 提取
// ---------------------------------------------------------------------------

/**
 * CDN / 反向代理常见注入的真实 IP 请求头。
 * EdgeOne 使用 EO-Connecting-IP；其余为通用约定。
 */
const IP_HEADER_PRIORITY = [
  "eo-connecting-ip",
  "cf-connecting-ip",
  "x-real-ip",
  "true-client-ip",
  "client-ip",
] as const;

/** Whether a string looks like a usable client address. */
function isUsableIp(value: string | undefined): value is string {
  if (!value) return false;
  const v = value.trim();
  return v.length > 0 && v.toLowerCase() !== "unknown";
}

/**
 * Best-effort extraction of the client's public IP from request headers.
 *
 * @param headers header map (keys lowercased)
 * @returns the extracted IP plus the header it came from; null when unknown
 */
export function extractClientIp(
  headers: Record<string, string>
): { ip: string; source: string } | null {
  // 先看专用请求头。
  for (const name of IP_HEADER_PRIORITY) {
    const value = headers[name];
    if (isUsableIp(value)) return { ip: value.trim(), source: name };
  }
  // x-forwarded-for 可能是链式列表 "client, proxy1, proxy2" — 取最左侧的一项。
  const xff = headers["x-forwarded-for"];
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (isUsableIp(first)) return { ip: first as string, source: "x-forwarded-for" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// User-Agent 解析
// ---------------------------------------------------------------------------

export type DeviceKind = "mobile" | "tablet" | "desktop" | "bot";

export interface UaInfo {
  browser: string;
  version: string | null;
  os: string;
  device: DeviceKind;
}

const BOT_PATTERNS = [
  "bot",
  "crawl",
  "spider",
  "slurp",
  "headlesschrome",
  "lighthouse",
  "curl/",
  "wget/",
];

/** Whether the request comes from a bot or automation tool. */
export function isBot(ua: string): boolean {
  const lower = ua.toLowerCase();
  return BOT_PATTERNS.some((p) => lower.includes(p));
}

interface BrowserRule {
  test: RegExp;
  name: string;
}

/**
 * 浏览器识别规则，按特异性排序：顺序错误会把
 * Edge/Opera 误判为 Chrome。Safari 必须在排除 Chrome 之后
 * 才允许匹配，因此有下面的兜底逻辑。
 */
const BROWSER_RULES: BrowserRule[] = [
  { test: /Edg(?:e|A|iOS)?\/([\d.]+)/, name: "Edge" },
  { test: /OPR\/([\d.]+)/, name: "Opera" },
  { test: /SamsungBrowser\/([\d.]+)/, name: "Samsung Internet" },
  { test: /YaBrowser\/([\d.]+)/, name: "Yandex Browser" },
  { test: /Firefox\/([\d.]+)/, name: "Firefox" },
  { test: /Chrome\/([\d.]+)/, name: "Chrome" },
];

/** 把 Windows NT 版本号映射为商业名称（仅常见版本）。 */
function windowsName(nt: string): string {
  if (nt.startsWith("10.")) return "Windows 10/11";
  if (nt === "6.3") return "Windows 8.1";
  if (nt === "6.2") return "Windows 8";
  if (nt === "6.1") return "Windows 7";
  return `Windows NT ${nt}`;
}

/** Normalizes underscore versions from UAs (17_5_1) into dotted form (17.5.1). */
function dots(s: string): string {
  return s.replace(/_/g, ".");
}

/**
 * Parses a User-Agent string into browser, OS and device kind.
 * Unrecognized inputs degrade to "Unknown" fields and never throw.
 */
export function parseUserAgent(ua: string): UaInfo {
  const empty: UaInfo = { browser: "Unknown", version: null, os: "Unknown", device: "desktop" };
  if (!ua) return empty;

  if (isBot(ua)) {
    return { browser: ua.trim().slice(0, 60), version: null, os: "-", device: "bot" };
  }

  // --- 浏览器 ---
  let browser = "Unknown";
  let version: string | null = null;
  for (const rule of BROWSER_RULES) {
    const m = ua.match(rule.test);
    if (m) {
      browser = rule.name;
      version = m[1] ?? null;
      break;
    }
  }
  // Safari 兜底：已排除 Chrome 内核，且存在 Version/x ... Safari。
  if (browser === "Unknown") {
    const m = ua.match(/Version\/([\d.]+).*Safari/);
    if (m && !ua.includes("Chrome")) {
      browser = "Safari";
      version = m[1];
    }
  }

  // --- Operating system ---
  let os = "Unknown";
  const nt = ua.match(/Windows NT ([\d.]+)/);
  const android = ua.match(/Android ([\d.]+)/);
  const ios = ua.match(/OS ([\d_]+) like Mac OS X/) ?? ua.match(/iPhone OS ([\d_]+)/);
  const macos = ua.match(/Mac OS X ([\d_.]+)/);

  if (nt) os = windowsName(nt[1]);
  else if (android) os = `Android ${android[1]}`;
  else if (ios) os = `iOS ${dots(ios[1])}`;
  else if (macos) os = `macOS ${dots(macos[1])}`;
  else if (/Linux/.test(ua)) os = "Linux";

  // --- 设备类型 ---
  let device: DeviceKind = "desktop";
  if (/iPad/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) device = "tablet";
  else if (/Mobi|iPhone|iPod/.test(ua)) device = "mobile";

  return { browser, version, os, device };
}
