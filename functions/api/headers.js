/**
 * 请求头回显端点（EdgeOne 边缘函数）— HTTP 检查页面的动态数据源。
 *
 * 返回「服务器视角」的方法、URL、来源 IP 与完整请求头，
 * 由浏览器端在客户端 fetch。响应永不缓存。
 *
 * 部署路径：/api/headers（functions/api/headers.js）
 */

export async function onRequestGet({ request }) {
  const headers = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  // x-forwarded-for 可能是链式列表 "client, proxy1, proxy2" — 取最左侧一项；
  // 没有该头时返回 null，交由客户端按优先级头自行判定。
  const xff = headers["x-forwarded-for"];
  const first = xff ? xff.split(",")[0]?.trim() : undefined;

  // 按名称对 headers 排序，便于肉眼浏览。
  // V8 运行时没有 Response.json 静态方法，须手工序列化。
  return new Response(
    JSON.stringify({
      method: request.method,
      url: request.url,
      ip: first ? first : null,
      headers: Object.fromEntries(
        Object.entries(headers).sort(([a], [b]) => a.localeCompare(b))
      ),
    }),
    { headers: { "content-type": "application/json", "cache-control": "no-store" } }
  );
}
