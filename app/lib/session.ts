import { cookies } from "next/headers";
import { verifyToken } from "@clerk/nextjs/server";

/**
 * Next.js 服务端会话读取（不依赖 clerkMiddleware 的 auth()）。
 *
 * 背景（EdgeOne Pages 生产限制）：适配器不透传 proxy.ts 中 clerkMiddleware
 * 的请求装饰——SSR 页面 / server action 里调用 auth() 会抛
 * "Clerk can't detect usage of clerkMiddleware()"（线上 500；本地 next dev
 * 正常，纯环境差异）。改用 Clerk 官方手动验签路径：读取 __session cookie，
 * 交由 @clerk/backend 的 verifyToken 完成（签名 + exp/nbf + clockSkewInMs
 * + 可选 authorizedParties；本文件不自己解析 JWT）。
 *
 * 密钥材料（二选一即可，verifyToken 原生支持 jwtKey 优先）：
 * - CLERK_SECRET_KEY：JWKS 从 SK 对应实例的官方 Backend API 回源（模块级
 *   缓存）；用户搜索 / 角色管理（clerkClient）也依赖它。
 * - CLERK_JWT_PUBLIC_KEY：Dashboard → API keys 的 Public key（PEM）。
 *   networkless 本地验签，免 JWKS 回源——部署环境出网受限 / 回源超时
 *   的自愈通道，也是免一次回源 RTT 的性能余量。仅适用于 RS256 生产
 *   实例（dev/test 实例签 ES256，PEM 路径不适用）。支持 \n 转义换行。
 *
 * 安全模型：verifyToken 的 JWKS 回源由 CLERK_SECRET_KEY 决定，签名验证
 * 天然绑定到 SK 所属的 Clerk 实例——其他实例签发的 token 必然验签失败。
 * 因此 issuer / azp 白名单在这里是可选的纵深加固而非必需关卡（与边缘函数
 * 不同：那边的 JWKS URL 从 token iss 构造，必须钉死白名单）：
 * - CLERK_ISSUER 设置时才校验 iss（多实例并存、想显式钉死时使用）；
 * - CLERK_AZP_ORIGINS（逗号分隔 origin）设置时才校验 azp。
 * 默认不钉死，dev 实例（*.clerk.accounts.dev）本地开发与生产实例部署
 * 开箱即用。
 *
 * 诊断（对齐边缘函数 x-auth-fail 的逐关哲学）：readSessionClaimsDetailed
 * 返回失败原因（no-cookie / no-key / verify-failed / issuer-mismatch）、
 * detail（verifyToken 错误摘要——单条错误 message 优先，兜底序列化整个
 * errors 数组）与 input（密钥材料的存在性/形态摘要，直接回答"环境变量
 * 是否到达了 SSR 运行时"），供门控页就地展示诊断卡而非静默弹回首页。
 * 所有失败一律不返回 claims（fail-closed），绝不抛 500。
 */

const SESSION_COOKIE = "__session";
const DETAIL_MAX_LENGTH = 200;

export type SessionClaims = CustomJwtSessionClaims & Record<string, unknown>;

export type SessionFailureReason =
  | "no-cookie"
  | "no-key"
  | "verify-failed"
  | "issuer-mismatch";

export type SessionResult = {
  claims: SessionClaims | null;
  reason: SessionFailureReason | null;
  /** 失败细节摘要（脱敏截断）；成功时为 null。 */
  detail: string | null;
  /** 验签输入侧摘要（sk/pem 存在性与形态）；仅环境相关失败时非 null。 */
  input: string | null;
};

/** issuer 比较前的尾斜杠归一化。 */
function normalizeIssuer(value: unknown): string {
  return String(value ?? "").replace(/\/+$/, "");
}

function commaList(raw: string | undefined): string[] | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const items = raw.split(",").map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : null;
}

/**
 * 从 verifyToken 的错误对象提取一行可展示的摘要（纯函数，可单测）。
 * 三级兜底：message → reason → JSON 序列化——生产实测上游可能抛出
 * 不带标准 message 的错误对象（EdgeOne SSR 运行时差异），诊断卡
 * 绝不允许因此空白。只取错误描述字段（message / reason 是原因码或
 * 网络失败说明，不含 token 与密钥）；空白归一并截断，防止超长破坏
 * 诊断卡排版。
 */
export function sanitizeVerifyDetail(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  const pick = (value: string): string | null => {
    const line = value.replace(/\s+/g, " ").trim();
    return line ? line.slice(0, DETAIL_MAX_LENGTH) : null;
  };
  if (typeof error === "string") return pick(error);
  if (error instanceof Error) return pick(error.message);
  // 非 Error 对象（上游行为变化 / 运行时差异）：message → reason → JSON。
  const candidate = error as { message?: unknown; reason?: unknown };
  if (typeof candidate.message === "string") {
    const fromMessage = pick(candidate.message);
    if (fromMessage) return fromMessage;
  }
  if (candidate.reason !== undefined && candidate.reason !== null) {
    const fromReason = pick(String(candidate.reason));
    if (fromReason) return fromReason;
  }
  try {
    return pick(JSON.stringify(error)) ?? pick(String(error));
  } catch {
    return pick(String(error));
  }
}

/**
 * 解析验签密钥材料（纯函数，可单测）：SK 与 PEM 至少其一即可完成验签；
 * 两者皆缺才视为环境未配置。PEM 中的字面 "\n"（反斜杠+n）还原为换行，
 * 兼容控制台环境变量不支持多行输入的部署面板。
 */
export function resolveVerifyKeys(
  env: Record<string, string | undefined> = process.env,
): { secretKey: string | null; jwtKey: string | null } {
  const pick = (name: string): string | null => {
    const raw = env[name];
    const value = typeof raw === "string" ? raw.trim() : "";
    return value ? value : null;
  };
  const jwtRaw = pick("CLERK_JWT_PUBLIC_KEY");
  return {
    secretKey: pick("CLERK_SECRET_KEY"),
    jwtKey: jwtRaw ? jwtRaw.replace(/\\n/g, "\n") : null,
  };
}

/**
 * 验签输入侧摘要（纯函数，可单测）：只含存在性布尔与形态线索（PEM
 * 长度 / 前 10 字符 / 是否为字面 \n 转义），不含任何密钥正文。部署后
 * 读一眼即可分辨：变量没配到运行时（sk:no pem:no）、值配错（head 不
 * 是 PEM 头）、换行未转义（esc=0 且多行被面板吞成单行）。
 */
export function describeVerifyInput(
  env: Record<string, string | undefined> = process.env,
): string {
  const { secretKey, jwtKey } = resolveVerifyKeys(env);
  const skPart = secretKey ? "sk:yes" : "sk:no";
  if (!jwtKey) return `${skPart} pem:no`;
  const head = jwtKey.slice(0, 10).replace(/\s+/g, "");
  const raw = env.CLERK_JWT_PUBLIC_KEY ?? "";
  const escaped = raw.includes("\\n");
  return `${skPart} pem:yes(len=${jwtKey.length},head=${head},esc=${escaped ? 1 : 0})`;
}

/**
 * 读取并验签当前请求的 Clerk 会话 claims；未登录 / 环境无任何验签密钥 /
 * 验签失败一律 claims: null 并附 reason + detail + input（fail-closed）。
 * 服务端组件与 server action 均可调用（不依赖 clerkMiddleware）。
 */
export async function readSessionClaimsDetailed(): Promise<SessionResult> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return { claims: null, reason: "no-cookie", detail: null, input: null };

  const { secretKey, jwtKey } = resolveVerifyKeys();
  if (!secretKey && !jwtKey) {
    return { claims: null, reason: "no-key", detail: null, input: describeVerifyInput() };
  }

  try {
    const { data, errors } = await verifyToken(token, {
      // verifyToken 原生优先走 jwtKey（networkless）；无 PEM 时回源 JWKS。
      secretKey: secretKey ?? undefined,
      jwtKey: jwtKey ?? undefined,
      // 可选加固：CLERK_AZP_ORIGINS 显式设置时才校验 azp（默认信任 Clerk）。
      authorizedParties: commaList(process.env.CLERK_AZP_ORIGINS) ?? undefined,
    });
    // verifyToken 的返回元素类型过宽（{}），收窄后再读字段/取错误。
    const claims = (data ?? null) as SessionClaims | null;
    if (errors || !claims) {
      const first = (errors as unknown[] | undefined)?.[0];
      return {
        claims: null,
        reason: "verify-failed",
        // 单条错误优先；无内容时序列化整个 errors 数组（含空数组的 "[]"，
        // 用于区分"上游返回了空错误列表"这一形态本身）。
        detail: sanitizeVerifyDetail(first) ?? sanitizeVerifyDetail(errors ?? null),
        input: describeVerifyInput(),
      };
    }

    // 可选加固：CLERK_ISSUER 显式设置时才钉死 issuer；detail 带实际 iss，
    // 生产配错时一眼可辨（iss 是公开的 issuer URL，非敏感）。
    const expectedIssuer = process.env.CLERK_ISSUER;
    if (expectedIssuer && normalizeIssuer(claims.iss) !== normalizeIssuer(expectedIssuer)) {
      return {
        claims: null,
        reason: "issuer-mismatch",
        detail: normalizeIssuer(claims.iss),
        input: describeVerifyInput(),
      };
    }
    return { claims, reason: null, detail: null, input: null };
  } catch (error) {
    // verifyToken 约定为返回 errors 而非抛出；此 catch 兜底上游行为变化。
    return {
      claims: null,
      reason: "verify-failed",
      detail: sanitizeVerifyDetail(error),
      input: describeVerifyInput(),
    };
  }
}

/** 便捷封装：只要 claims（null = 未登录或任何失败）。 */
export async function readSessionClaims(): Promise<SessionClaims | null> {
  return (await readSessionClaimsDetailed()).claims;
}
