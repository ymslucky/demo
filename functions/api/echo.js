/**
 * JSON echo 端点（EdgeOne 边缘函数）— HTTP 检查工具的数据源。
 *
 * 返回服务端看到的一切：IP、方法、URL、时间与完整请求头。
 * 挂到 onRequest（而非 onRequestGet）以接受全部 HTTP 方法，
 * 让站点同时充当调试回环。响应永不缓存。
 *
 * 部署路径：/api/echo（functions/api/echo.js）
 */

// 与 app/[locale]/tools/http-check/utils.ts 保持相同的 IP 头优先级。
const IP_HEADER_PRIORITY = [
  "eo-connecting-ip",
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

async function echo({ request }) {
  const headers = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const url = new URL(request.url);
  return Response.json(
    {
      ok: true,
      method: request.method,
      host: url.host,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      receivedAt: new Date().toISOString(),
      clientIp: extractClientIp(headers),
      userAgent: headers["user-agent"] ?? null,
      // 按名称对 headers 排序，便于肉眼浏览。
      headers: Object.fromEntries(Object.entries(headers).sort(([a], [b]) => a.localeCompare(b))),
    },
    { headers: { "cache-control": "no-store" } }
  );
}

export const onRequest = echo;
