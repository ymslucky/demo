import { extractClientIp } from "@/app/[locale]/tools/http-check/utils";

/**
 * JSON echo 端点 — HTTP 检查工具的数据源。
 *
 * 返回服务端看到的一切：IP、方法、URL、时间与完整请求头。
 * 接受 GET / POST（以及任何其他方法），让站点同时充当调试回环。
 */

/** 依赖请求上下文，因此每次调用都必须动态运行。 */
export const dynamic = "force-dynamic";

function echo(request: Request) {
  const headers: Record<string, string> = {};
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

export const GET = echo;
export const POST = echo;
