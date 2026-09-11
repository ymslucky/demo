/**
 * shared/auth-core.js —— Clerk 会话判定的单一真源（零依赖纯 JS）。
 * 本文件由 index.js 聚合导出（@lucky/auth-core 出口）。
 *
 * 复用方式（双通道，见 AGENTS.md §0.1）：
 * - Next SSR 层（app/lib / 直接 `import` 本模块——运行时有模块解析；
 * - 自包含层（functions 下各 js、agents 下 code-run 的 ts）由
 *   scripts/sync-shared.cjs 把本文件**全文**注入目标文件内的一对
 *   "shared:auth-core" 开始/结束标记区间（EdgeOne 边缘函数与 Makers
 *   agents 单文件部署、禁止运行时 import——构建期分发是唯一复用通道）。
 *   区间内容随提交进仓库，函数文件保持可独立部署；`npm test` 前置
 *   `sync-shared.cjs --check` 防漂移。
 *
 * 修改本文件后必须运行 `node scripts/sync-shared.cjs` 同步区间。
 * 全部为纯函数：不触网络、不读环境（env 由调用方读取后传入），三大
 * 运行时（EO 边缘 / Makers agents / Node SSR）行为一致。
 */

/** SITE_DOMAIN 未配置时的默认站点 apex（与边缘函数历史默认一致）。 */
export const DEFAULT_SITE_APEX = "rdom.cn";

/** 管理员角色名（Clerk publicMetadata.role / claims.metadata.role）。 */
export const ADMIN_ROLE = "admin";

/**
 * 访问域名归一化：接受 "rdom.cn" / "https://rdom.cn" / "https://www.rdom.cn"
 * 等写法，剥离协议、路径与 www 前缀，返回裸 apex 域名；非字符串或空返回 null。
 * @param {unknown} raw 环境变量原始值
 * @returns {string | null}
 */
export function siteApex(raw) {
  if (typeof raw !== "string") return null;
  const host = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0];
  if (!host) return null;
  return host.startsWith("www.") ? host.slice(4) : host;
}

/** issuer 比较前的尾斜杠归一化。 */
export function normalizeIssuer(value) {
  return String(value ?? "").replace(/\/+$/, "");
}

/**
 * 逗号分隔的环境变量值 → 去空白非空数组；空值/全空白返回 null。
 * @param {string | undefined} raw
 * @returns {string[] | null}
 */
export function parseList(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const items = raw.split(",").map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : null;
}

/**
 * 会话验签的 issuer 白名单：显式 CLERK_ISSUER 逗号列表优先（多实例并存
 * /显式钉死），否则按 Clerk 自定义实例惯例由 SITE_DOMAIN 派生
 * `https://clerk.<apex>`；SITE_DOMAIN 也未配置时退回默认 apex。
 * @param {object} [env] 已读取的环境变量切片
 * @param {string | undefined} [env.siteDomain] SITE_DOMAIN 原始值
 * @param {string | undefined} [env.clerkIssuer] CLERK_ISSUER 原始值
 * @returns {string[]}
 */
export function deriveIssuers({ siteDomain, clerkIssuer } = {}) {
  const explicit = parseList(clerkIssuer);
  if (explicit) return explicit;
  return [`https://clerk.${siteApex(siteDomain) ?? DEFAULT_SITE_APEX}`];
}

/**
 * azp 的来源 origin 是否属于本站：host 等于 apex，或以 ".<apex>" 结尾
 * （任意子域）。前导点保证边界——仅共享后缀片段的域名不会误匹配。
 * @param {unknown} azp claims.azp（缺失时由调用方放行，不进本函数）
 * @param {unknown} apex 站点 apex（siteApex 的返回值）
 * @returns {boolean}
 */
export function isAllowedAzp(azp, apex) {
  if (typeof azp !== "string" || typeof apex !== "string") return false;
  const host = azp
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split(/[:/?]/)[0];
  return !!host && (host === apex || host.endsWith(`.${apex}`));
}

/**
 * 会话 claims → 角色名：session token 定制把 publicMetadata 注入
 * claims.metadata.role（随 JWT 签名，验签后可信）；缺失/畸形返回空串。
 * @param {Record<string, unknown> | null | undefined} payload
 * @returns {string}
 */
export function roleFromClaims(payload) {
  const metadata = payload?.metadata;
  // "in" 守卫而非直接属性访问：JS 语义不变，同时在注入 .ts 目标时让
  // TS 4.9+ 把 metadata 正确窄化出 role 属性（object 类型直接取属性
  // 会触发 noImplicitAny/TS2339）。
  if (metadata && typeof metadata === "object" && "role" in metadata) {
    const role = metadata.role;
    return typeof role === "string" ? role : "";
  }
  return "";
}
