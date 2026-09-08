/**
 * JSON echo 端点（EdgeOne 边缘函数）— HTTP 检查工具的数据源。
 *
 * 返回服务端看到的一切：IP、方法、URL、时间与完整请求头。
 * 按方法导出命名处理器以接受全部 HTTP 方法，让站点同时充当调试回环。
 * 响应永不缓存。
 *
 * 部署路径：/api/echo（functions/api/echo.js）
 */

// 与 app/[locale]/tools/http-check/utils.ts 保持相同的 IP 头优先级。
const IP_HEADER_PRIORITY = [
  "eo-connecting-ip",
  "eo-client-ip",
  "cf-connecting-ip",
  "x-real-ip",
  "true-client-ip",
  "client-ip",
];

function isUsableIp(value) {
  return Boolean(value && value.trim().length > 0 && value.trim().toLowerCase() !== "unknown");
}

/** 按优先级提取客户端 IP；提取不到返回 null。导出仅供测试。 */
export function extractClientIp(headers) {
  for (const name of IP_HEADER_PRIORITY) {
    const value = headers[name];
    if (isUsableIp(value)) return { ip: value.trim(), source: name };
  }
  const xff = headers["x-forwarded-for"];
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (isUsableIp(first)) return { ip: first, source: "x-forwarded-for" };
  }
  return null;
}

/**
 * EdgeOne 在 request.eo 上注入客户端上下文（IP/地理），
 * 部分部署形态不注入 IP 请求头，这里作为兜底来源。
 */
function extractEoClientIp(request) {
  const eo = request && request.eo;
  if (!eo) return null;
  const candidates = [eo.ip, eo.geo && eo.geo.ip];
  for (const value of candidates) {
    if (isUsableIp(value)) return { ip: String(value).trim(), source: "eo-context" };
  }
  return null;
}

async function echo({ request }) {
  const headers = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  // 防御性解析：request.url 预期是绝对 URL，但解析失败不应让整个脚本崩溃。
  let url = null;
  try {
    url = new URL(request.url);
  } catch {
    url = null;
  }

  const clientIp = extractClientIp(headers) ?? extractEoClientIp(request);

  // V8 运行时没有 Response.json 静态方法，须手工序列化。
  return new Response(
    JSON.stringify({
      ok: true,
      method: request.method,
      host: url ? url.host : null,
      path: url ? url.pathname : null,
      query: url ? Object.fromEntries(url.searchParams) : {},
      receivedAt: new Date().toISOString(),
      clientIp,
      userAgent: headers["user-agent"] ?? null,
      // 按名称对 headers 排序，便于肉眼浏览。
      headers: Object.fromEntries(Object.entries(headers).sort(([a], [b]) => a.localeCompare(b))),
    }),
    { headers: { "content-type": "application/json", "cache-control": "no-store" } }
  );
}

// 修复记录：此前以 `export const onRequest = echo` 部署，是全站唯一使用该
// 导出形态的函数，线上持续返回 545 脚本错误。改为下方方法特定的命名函数
// 导出——与本仓库其余已验证可用的函数及官方文档一致的形态。
export async function onRequestGet(context) {
  return echo(context);
}

export async function onRequestPost(context) {
  return echo(context);
}

export async function onRequestPut(context) {
  return echo(context);
}

export async function onRequestPatch(context) {
  return echo(context);
}

export async function onRequestDelete(context) {
  return echo(context);
}

export async function onRequestHead(context) {
  return echo(context);
}

export async function onRequestOptions(context) {
  return echo(context);
}
