/**
 * JWKS 获取与缓存（单一真源 @lucky/auth-core）。
 * 模块级缓存：iss → { keys, expiresAt }，TTL 1 小时；forceRefresh 跳过
 * 缓存读取（kid 未命中的自愈路径），刷新结果仍写回缓存。
 */
export const JWKS_TTL_MS = 3_600_000;

const jwksCache = new Map();

export async function getJwks(issuer, { forceRefresh = false } = {}) {
  const iss = String(issuer).replace(/\/+$/, "");
  const cached = jwksCache.get(iss);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.keys;

  const res = await fetch(`${iss}/.well-known/jwks.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`jwks-http-${res.status}`);
  const data = await res.json();
  const keys = Array.isArray(data?.keys) ? data.keys : null;
  if (!keys) throw new Error("jwks-shape");
  jwksCache.set(iss, { keys, expiresAt: Date.now() + JWKS_TTL_MS });
  return keys;
}

/** 测试专用：清空模块级 JWKS 缓存（跨用例隔离）。 */
export function resetJwksCache() {
  jwksCache.clear();
}
