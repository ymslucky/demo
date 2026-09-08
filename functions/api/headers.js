/**
 * 请求头回显端点（EdgeOne 边缘函数）— HTTP 检查页面的动态数据源。
 *
 * 返回「服务器视角」的方法、URL、来源 IP、地理信息与完整请求头，
 * 由浏览器端在客户端 fetch。响应永不缓存。
 *
 * 部署路径：/api/headers（functions/api/headers.js）
 */

// 与 functions/api/echo.js、app/[locale]/tools/http-check/utils.ts 保持一致。
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

/** 按优先级头 + x-forwarded-for 最左段提取客户端 IP，提取不到返回 null。 */
function extractIp(headers) {
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
 * EdgeOne 在 request.eo 上注入客户端上下文（IP/地理）。
 * 部分部署形态不注入任何 IP 请求头，此时 ip/geo 只能来自这里。
 */
function extractEo(request) {
  const eo = request && request.eo;
  if (!eo) return { ip: null, geo: null };

  let ip = null;
  for (const value of [eo.ip, eo.geo && eo.geo.ip]) {
    if (isUsableIp(value)) {
      ip = { ip: String(value).trim(), source: "eo-context" };
      break;
    }
  }

  const geo = eo.geo && typeof eo.geo === "object" ? eo.geo : null;
  const picked = {};
  if (geo) {
    for (const key of [
      "countryName",
      "countryCode",
      "regionName",
      "cityName",
      "latitude",
      "longitude",
      "timezone",
    ]) {
      const value = geo[key];
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        picked[key] = String(value);
      }
    }
  }
  return { ip, geo: Object.keys(picked).length > 0 ? picked : null };
}

export async function onRequestGet({ request }) {
  const headers = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  // 客户端 IP：优先取注入的 IP 请求头，缺头的部署形态回退到 request.eo 上下文。
  const fromHeaders = extractIp(headers);
  const eo = extractEo(request);
  const ip = fromHeaders ?? eo.ip;

  // 按名称对 headers 排序，便于肉眼浏览。
  // V8 运行时没有 Response.json 静态方法，须手工序列化。
  return new Response(
    JSON.stringify({
      method: request.method,
      url: request.url,
      ip: ip ? ip.ip : null,
      ipSource: ip ? ip.source : null,
      geo: eo.geo,
      headers: Object.fromEntries(
        Object.entries(headers).sort(([a], [b]) => a.localeCompare(b))
      ),
    }),
    { headers: { "content-type": "application/json", "cache-control": "no-store" } }
  );
}
