/**
 * Pure helpers for the HTTP check tool.
 *
 * Extracted from the page and API route so they can be unit tested and
 * reused. Output names (browser / OS etc.) stay in their canonical English
 * form and are not part of i18n.
 */

// ---------------------------------------------------------------------------
// Client IP extraction
// ---------------------------------------------------------------------------

/**
 * Real-IP headers commonly injected by CDNs / reverse proxies.
 * EdgeOne uses EO-Connecting-IP; the rest are generic conventions.
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
  // Dedicated headers first.
  for (const name of IP_HEADER_PRIORITY) {
    const value = headers[name];
    if (isUsableIp(value)) return { ip: value.trim(), source: name };
  }
  // x-forwarded-for may be a chain "client, proxy1, proxy2" — take the leftmost entry.
  const xff = headers["x-forwarded-for"];
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (isUsableIp(first)) return { ip: first as string, source: "x-forwarded-for" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// User-Agent parsing
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
 * Browser detection rules, ordered by specificity: a wrong order would
 * classify Edge/Opera as Chrome. Safari must only match after Chrome has
 * been excluded, hence the fallback below.
 */
const BROWSER_RULES: BrowserRule[] = [
  { test: /Edg(?:e|A|iOS)?\/([\d.]+)/, name: "Edge" },
  { test: /OPR\/([\d.]+)/, name: "Opera" },
  { test: /SamsungBrowser\/([\d.]+)/, name: "Samsung Internet" },
  { test: /YaBrowser\/([\d.]+)/, name: "Yandex Browser" },
  { test: /Firefox\/([\d.]+)/, name: "Firefox" },
  { test: /Chrome\/([\d.]+)/, name: "Chrome" },
];

/** Maps Windows NT versions to marketing names (common ones only). */
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

  // --- Browser ---
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
  // Safari fallback: Chrome engine excluded, Version/x ... Safari present.
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

  // --- Device kind ---
  let device: DeviceKind = "desktop";
  if (/iPad/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) device = "tablet";
  else if (/Mobi|iPhone|iPod/.test(ua)) device = "mobile";

  return { browser, version, os, device };
}
