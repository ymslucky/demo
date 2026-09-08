/**
 * GitHub stars 代理（EdgeOne 边缘函数 + KV 缓存）— 供 about 页的
 * GithubStarsCard 客户端组件读取。
 *
 * 缓存模型（EdgeOne Pages KV，官方文档语义）：
 * - 单一缓存 key stars_cache_v1，值形如 { fetchedAt, payload }；
 * - fetchedAt 距今不足 1h 视为新鲜，直接返回缓存；
 * - 未命中则回源 GitHub REST；成功后写回 KV；
 * - 回源失败时回退过期缓存（stale-while-error），连缓存都没有才 502；
 * - KV 最终一致（约 60s 同步），对 1h 粒度的缓存无感知影响。
 *
 * KV 命名空间须在控制台绑定到项目，变量名为 luckylab_kv；未绑定时
 * 行为退化为每次直接回源（与无缓存版本等价），不影响可用性。
 *
 * 部署路径：/api/github/stars（functions/api/github/stars.js）
 */

const CACHE_KEY = "stars_cache_v1";
const FRESH_MS = 3_600_000;
const KV_BINDING = "luckylab_kv";

function getKv(env) {
  return env?.[KV_BINDING] ?? globalThis?.[KV_BINDING] ?? null;
}

function jsonResponse(body, extraHeaders = {}, status = 200) {
  // V8 运行时没有 Response.json 静态方法，须手工序列化。
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

/** 缓存记录在 now 时刻是否仍新鲜。导出仅供测试。 */
export function isFresh(record, now = Date.now()) {
  return Boolean(
    record &&
      Number.isFinite(record.fetchedAt) &&
      now - record.fetchedAt < FRESH_MS
  );
}

/** 由 GitHub /users/{login}/repos 数组构建展示载荷。导出仅供测试。 */
export function buildStarsPayload(repos) {
  return {
    totalStars: repos.reduce((sum, repo) => sum + (repo?.stargazers_count ?? 0), 0),
    publicRepoCount: repos.length,
    // top 3 by stars，忽略空仓库名等异常条目。
    top: repos
      .filter((repo) => typeof repo?.name === "string")
      .sort((a, b) => (b.stargazers_count ?? 0) - (a.stargazers_count ?? 0))
      .slice(0, 3)
      .map((repo) => ({
        name: repo.name,
        stars: repo.stargazers_count ?? 0,
        htmlUrl: repo.html_url,
      })),
  };
}

async function readCache(kv) {
  if (!kv) return null;
  try {
    // 官方 get 签名为 get(key, type?)，type 是位置参数（'json' 自动反序列化）。
    const record = await kv.get(CACHE_KEY, "json");
    return record && typeof record === "object" ? record : null;
  } catch {
    return null;
  }
}

async function writeCache(kv, payload) {
  if (!kv) return;
  try {
    await kv.put(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), payload }));
  } catch {
    // 缓存写失败不影响本次响应。
  }
}

export async function onRequest({ env }) {
  const kv = getKv(env);
  const cached = await readCache(kv);
  if (isFresh(cached)) {
    return jsonResponse(cached.payload);
  }

  const login = env?.GITHUB_LOGIN ?? "ymslucky";
  const token = env?.GITHUB_TOKEN;
  try {
    const upstream = await fetch(
      `https://api.github.com/users/${login}/repos?per_page=100&sort=pushed`,
      {
        headers: {
          accept: "application/vnd.github+json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      }
    );
    if (!upstream.ok) throw new Error("upstream");
    const repos = await upstream.json();
    if (!Array.isArray(repos)) throw new Error("upstream");

    const payload = buildStarsPayload(repos);
    await writeCache(kv, payload);
    return jsonResponse(payload);
  } catch {
    // 上游失败：回退过期缓存，仍无缓存才向上报错。
    if (cached?.payload) {
      return jsonResponse(cached.payload);
    }
    return jsonResponse({ error: "upstream" }, {}, 502);
  }
}
