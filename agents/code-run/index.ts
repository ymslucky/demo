/**
 * POST /code-run —— 代码沙箱执行端点（EdgeOne Makers Agent 运行时专属）。
 *
 * 仅在 Makers Agent 运行时可用（依赖 context.sandbox）；本地 next dev 无此
 * 路由属预期，前端会以"沙箱不可用"文案降级。沙箱实例按请求头
 * makers-conversation-id 绑定到浏览器会话：同一会话懒创建并复用同一实例，
 * 更换 ID 即得到全新沙箱（重置按钮的实现原理）。
 *
 * 动作（JSON body.action）：
 * - run    { language, code, timeoutSec?, lifetimeSec? }  执行代码 →
 *          stdout/stderr/results/exitCode；运行前寿命检查：懒创建实例的
 *          默认寿命 = edgeone.json sandbox.timeout（60s，到点自动回收），
 *          剩余不足 lifetimeSec（默认 60s、clamp 到 [60, 600]）时补足差额，
 *          绝不无谓延长（用户选 1 分钟 → 实例 1 分钟后回收）
 * - info   {}                               沙箱实例信息（实例 ID / 到期时间 / 外部访问地址）
 * - extend { seconds }                      续期实例（extendTimeout）
 * - kill   {}                               销毁实例（重置会话时调用）
 *
 * 登录门控（全动作生效）：仅登录用户可用。读取 __session cookie 中的
 * Clerk 会话 JWT 并完整验签（八步清单；RS256 走纯 JS BigInt 实现——边缘
 * 运行时 crypto.subtle 不支持 RSA，见 verifyRs256 注释），失败返回
 * 401 unauthorized 并附 x-auth-fail 诊断头。认证函数自
 * functions/api/todo.js 移植为 TS，本文件保持自包含（零 import）。
 *
 * run 动作限速：每用户每小时 10 次，模块级内存滑动窗口（Makers agents
 * 运行时无 KV——KV 仅边缘函数可用；实例内存只在实例存活期间连续计数，
 * 重启或多实例部署各计各的，属尽力而为的近似限速）。参数校验通过后
 * 计数，失败运行同样消耗额度；超限返回 429 rate-limited（附 retry-after）。
 *
 * issuer 白名单 / azp 判定基准由 context.env.SITE_DOMAIN 在请求时派生
 * （Makers 运行时无 process.env），未配置默认 rdom.cn。
 *
 * 语言路由：
 * - python / javascript → sandbox.runCode（Jupyter 内核，顶层方法）
 * - bash                → sandbox.commands.run（timeout 单位为秒）
 * - go / java           → files.write 写入源文件后 commands.run 调工具链
 *   （go run / java 单文件启动；Java 公共类须命名为 Main）
 *
 * 本文件保持自包含（不 import 仓库内模块），全部类型为结构性声明，
 * 以便 next build 对 agents/** 的类型检查无需 Makers SDK 依赖。
 */

/** 沙箱能力面的最小结构声明（实际运行时由 Makers 注入）。 */
type SandboxLike = {
  runCode?: (
    code: string,
    opts: { language?: string; timeout?: number },
  ) => Promise<{ results?: unknown; logs?: unknown; error?: unknown } | null | undefined>;
  commands?: {
    run?: (
      cmd: string,
      opts: { cwd?: string; env?: Record<string, string>; timeout?: number },
    ) => Promise<{ stdout?: unknown; stderr?: unknown; exitCode?: unknown } | null | undefined>;
  };
  files?: { write?: (path: string, content: string) => Promise<unknown> };
  getInfo?: () => Promise<Record<string, unknown> | null | undefined>;
  getHost?: (port: number) => Promise<unknown>;
  extendTimeout?: (seconds: number) => Promise<unknown>;
  kill?: () => Promise<unknown>;
};

/** Makers Agent 请求上下文的最小结构声明。 */
type AgentContext = {
  request?: {
    body?: unknown;
    headers?: Record<string, unknown>;
    signal?: { aborted?: boolean };
  };
  conversation_id?: string;
  sandbox?: SandboxLike | null;
  env?: Record<string, string>;
};

const LANGUAGE_IDS = ["python", "javascript", "bash", "go", "java"] as const;
type LanguageId = (typeof LANGUAGE_IDS)[number];
export type { LanguageId };

const MAX_CODE_LEN = 20_000;
const DEFAULT_TIMEOUT_S = 30;
const MAX_TIMEOUT_S = 60;
const HOST_PORT = 8080;

// 实例生命周期（秒）：用户可选寿命的 clamp 边界（默认 1 分钟、可选 1-10
// 分钟）。懒创建实例的平台默认寿命由 edgeone.json sandbox.timeout（60s，
// 到点自动回收）决定——SDK 只有续期语义、无法缩短，用户选 1 分钟时依赖
// 该默认值精确生效；选择更长寿命时 run 前按剩余差额续期。
const MIN_LIFETIME_S = 60;
const MAX_LIFETIME_S = 600;
const DEFAULT_LIFETIME_S = 60;

/** 手工序列化 JSON 响应（no-store：响应随会话/实例状态变化，绝不缓存）。 */
function json(
  body: Record<string, unknown>,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

/** 未知值 → 可展示文本；空值归一为空字符串。 */
function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

/**
 * runCode 返回 → (stdout, stderr, 富结果)。
 * 内核的流输出既可能在 logs，也可能藏在 results 元素的流回执块
 * {stdout: string[], stderr: string[]}（\n 保留在字符串内，join 即还原换行）；
 * 其余对象（表格 / 图片 / {text} 等富结果）原样保留给前端渲染。
 */
export function flattenKernelOutput(out: { results?: unknown; logs?: unknown } | null | undefined): {
  stdout: string;
  stderr: string;
  results: unknown[];
} {
  const stdoutParts: string[] = [];
  const stderrParts: string[] = [];
  const richResults: unknown[] = [];

  const visit = (entries: unknown, fromLogs: boolean): void => {
    const list = Array.isArray(entries) ? entries : entries == null ? [] : [entries];
    for (const item of list) {
      if (typeof item === "string") {
        if (item.length === 0) continue;
        (fromLogs ? stdoutParts : richResults).push(item);
        continue;
      }
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      if (Array.isArray(obj.stdout) || Array.isArray(obj.stderr)) {
        if (Array.isArray(obj.stdout)) stdoutParts.push(obj.stdout.map(asText).join(""));
        if (Array.isArray(obj.stderr)) stderrParts.push(obj.stderr.map(asText).join(""));
        continue;
      }
      const text = obj.text ?? obj.output ?? obj.message;
      if (fromLogs && text !== undefined) {
        stdoutParts.push(asText(text));
        continue;
      }
      richResults.push(item);
    }
  };

  visit(out?.logs, true);
  visit(out?.results, false);
  return { stdout: stdoutParts.join(""), stderr: stderrParts.join(""), results: richResults };
}

/** error 可能是字符串或 {name,message,traceback} 对象，统一为可读文本。 */
export function errorText(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const name = asText(obj.name);
    const message = asText(obj.message);
    const traceback = asText(obj.traceback);
    const head = name && message ? `${name}: ${message}` : name || message;
    if (head && traceback) return `${head}\n${traceback}`;
    return head || traceback || asText(value);
  }
  return String(value);
}

/** timeoutSec 白名单化：仅接受正数，clamp 到 [1, MAX_TIMEOUT_S]。 */
function clampTimeout(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return typeof value === "undefined" || value === null ? DEFAULT_TIMEOUT_S : null;
  }
  return Math.min(Math.max(Math.round(value), 1), MAX_TIMEOUT_S);
}

/**
 * lifetimeSec 白名单化：正数四舍五入后 clamp 到 [60, 600]；缺省/非法回退
 * 默认 60s（即"默认 1 分钟、可选 1-10 分钟"）。平台默认寿命与续期策略见
 * 顶部常量注释（edgeone.json sandbox.timeout = 60s）。导出仅供测试。
 */
export function clampLifetime(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_LIFETIME_S;
  return Math.min(Math.max(Math.round(value), MIN_LIFETIME_S), MAX_LIFETIME_S);
}

/** getInfo() 快照 → 前端信息面板所需的稳定字段。 */
function sandboxSnapshot(info: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!info) return {};
  const expiresAt = asText(
    info.expiresAt ?? info.expires_at ?? info.timeoutAt ?? info.endAt ?? "",
  );
  const snapshot: Record<string, unknown> = {
    instanceId: asText(info.id ?? info.instanceId ?? info.sandboxId ?? ""),
  };
  if (expiresAt) snapshot.expiresAt = expiresAt;
  return snapshot;
}

/** getHost() 可能返回字符串或 {url} 对象，统一为 URL 文本。 */
async function externalHostUrl(sandbox: SandboxLike): Promise<string> {
  if (typeof sandbox.getHost !== "function") return "";
  try {
    const host = await sandbox.getHost(HOST_PORT);
    if (typeof host === "string") return host;
    if (host && typeof host === "object") {
      const obj = host as Record<string, unknown>;
      return asText(obj.url ?? obj.host ?? "");
    }
    return "";
  } catch {
    return "";
  }
}

/** 单次执行：按语言路由到内核 / shell / 工具链，统一产出结构化结果。 */
export async function execute(
  sandbox: SandboxLike,
  language: LanguageId,
  code: string,
  timeoutSec: number,
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  results: unknown[];
  error: string;
  elapsedMs: number;
}> {
  const startedAt = Date.now();
  let exitCode = 0;
  let stdout = "";
  let stderr = "";
  let results: unknown[] = [];
  let error = "";

  const readProcess = (out: { stdout?: unknown; stderr?: unknown; exitCode?: unknown } | null | undefined) => {
    stdout = asText(out?.stdout);
    stderr = asText(out?.stderr);
    const code2 = out?.exitCode;
    exitCode = typeof code2 === "number" ? code2 : Number(code2 ?? 0) || 0;
  };

  if (language === "python" || language === "javascript") {
    const out = await sandbox.runCode?.(code, { language, timeout: timeoutSec });
    const kernel = flattenKernelOutput(out);
    stdout = kernel.stdout;
    stderr = kernel.stderr;
    results = kernel.results;
    const err = errorText(out?.error);
    if (err) {
      stderr = err;
      error = err;
      exitCode = 1;
    }
  } else if (language === "bash") {
    readProcess(await sandbox.commands?.run?.(code, { timeout: timeoutSec }));
  } else if (language === "go") {
    await sandbox.files?.write?.("/tmp/main.go", code);
    readProcess(
      await sandbox.commands?.run?.("cd /tmp && go run main.go", { timeout: timeoutSec }),
    );
  } else {
    await sandbox.files?.write?.("/tmp/Main.java", code);
    readProcess(
      await sandbox.commands?.run?.("cd /tmp && java Main.java", { timeout: timeoutSec }),
    );
  }

  return { exitCode, stdout, stderr, results, error, elapsedMs: Date.now() - startedAt };
}

// ---------------------------------------------------------------------------
// Clerk 会话验证（自 functions/api/todo.js 移植为 TS，零 import 自包含）
//
// 八步清单：parse → alg 分派（仅 ES256/RS256）→ 钉死 issuer 白名单 →
// azp 校验（缺失放行）→ exp/nbf（5s 容差）→ sts → kid 匹配（未命中强制
// 刷新 JWKS 一次）→ 验签。与 todo.js 的差异只有两处：
// - headers 是普通对象（Makers 运行时无 Headers.get），cookie 直接取
//   headers["cookie"]；
// - issuer 白名单 / azp 基准不在模块级派生（Makers 运行时无 process.env），
//   改为请求时从 context.env.SITE_DOMAIN 派生并注入 verifyAgentSession。
// ---------------------------------------------------------------------------

type Jwk = Record<string, unknown>;
type JwkKeys = Jwk[];

const JWKS_TTL_MS = 3_600_000;
const CLOCK_SKEW_S = 5;
const DEFAULT_SITE_APEX = "rdom.cn";

/** 访问域名 → 裸 apex（剥协议/路径/www）；非字符串或空值返回 null。导出仅供测试。 */
export function siteApex(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const host = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0];
  if (!host) return null;
  return host.startsWith("www.") ? host.slice(4) : host;
}

/** 从普通对象 headers 的 cookie 中提取 __session JWT（字符集 URL 安全）。 */
function readCookieToken(headers: Record<string, unknown> | undefined): string | null {
  const raw = headers?.cookie;
  const cookie =
    typeof raw === "string" ? raw : Array.isArray(raw) ? raw.join("; ") : "";
  const match = cookie.match(/(?:^|;\s*)__session=([^;]*)/);
  return match ? match[1].trim() : null;
}

/** base64url 段解码为字节（自动补齐 padding）；标注 ArrayBuffer 以满足 BufferSource。 */
function base64UrlDecode(segment: string): Uint8Array<ArrayBuffer> {
  const b64 = String(segment).replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 拆解 JWT 三段并解析 header/payload；任何畸形输入返回 null。 */
function parseTokenPayload(token: unknown): {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signingInput: string;
  signature: Uint8Array<ArrayBuffer>;
} | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) return null;
  try {
    const decoder = new TextDecoder();
    const header = JSON.parse(decoder.decode(base64UrlDecode(parts[0])));
    const payload = JSON.parse(decoder.decode(base64UrlDecode(parts[1])));
    if (typeof header !== "object" || header === null) return null;
    if (typeof payload !== "object" || payload === null) return null;
    return {
      header: header as Record<string, unknown>,
      payload: payload as Record<string, unknown>,
      signingInput: `${parts[0]}.${parts[1]}`,
      signature: base64UrlDecode(parts[2]),
    };
  } catch {
    return null;
  }
}

// RS256 纯 JS 验签（BigInt RSA 公钥运算）：边缘运行时 crypto.subtle 不支持
// RSASSA-PKCS1-v1_5（生产 Clerk 实例签发 RS256，importKey/verify 抛异常 →
// 401 且 x-auth-fail: crypto，先例见 todo.js），因此绝不走 Web Crypto 做
// RSA 验签；SHA-256 摘要仍用 subtle.digest，填充比对采用 EMSA-PKCS1-v1_5
// （RFC 8017 §9.2）。公开指数 e=65537 仅 17 位，2048 位模长约 18 次 BigInt
// 模运算，亚毫秒级。

/** SHA-256 的 DER DigestInfo 前缀（RFC 8017 §9.2 注 1），共 19 字节。 */
const SHA256_DIGEST_INFO = Uint8Array.from([
  0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01,
  0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20,
]);

/** 字节序列 → BigInt（大端序）。 */
function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

/** BigInt → 定长 k 字节大端字节序列（调用方保证 value < 2^(8k)，不截断）。 */
function bigIntToBytes(value: bigint, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i -= 1) {
    bytes[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return bytes;
}

/** BigInt 模幂（平方-乘法）：base^exponent mod modulus。 */
function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

/** RS256（RSASSA-PKCS1-v1_5 + SHA-256）纯 JS 验签；任何异常一律 false。 */
async function verifyRs256(
  jwk: Jwk,
  signingInput: string,
  signature: Uint8Array,
  cryptoObj: Crypto,
): Promise<boolean> {
  try {
    // 标准 RSA JWK 的 n 按"去前导零"序列化，解码后恰为模长 k 字节。
    const nBytes = base64UrlDecode(String(jwk.n));
    const k = nBytes.length;
    if (k < 20 || signature.length !== k) return false;
    const n = bytesToBigInt(nBytes);
    const s = bytesToBigInt(signature);
    // RFC 8017 §5.2.2 步骤 2b：s 不在 [0, n-1] 内即无效。
    if (s >= n) return false;

    // RSA 公钥运算：em = s^e mod n。
    const e = bytesToBigInt(base64UrlDecode(String(jwk.e)));
    const em = bigIntToBytes(modPow(s, e, n), k);

    // EMSA-PKCS1-v1_5 编码比对：00 01 FF..FF 00 || DigestInfo || H(m)。
    const hash = new Uint8Array(
      await cryptoObj.subtle.digest("SHA-256", new TextEncoder().encode(signingInput)),
    );
    const t = SHA256_DIGEST_INFO.length + hash.length;
    if (k < t + 11 || em[0] !== 0x00 || em[1] !== 0x01) return false;
    let idx = 2;
    while (idx < k - t - 1) {
      if (em[idx] !== 0xff) return false;
      idx += 1;
    }
    if (em[idx] !== 0x00) return false;
    idx += 1;
    for (let i = 0; i < SHA256_DIGEST_INFO.length; i += 1) {
      if (em[idx + i] !== SHA256_DIGEST_INFO[i]) return false;
    }
    idx += SHA256_DIGEST_INFO.length;
    for (let i = 0; i < hash.length; i += 1) {
      if (em[idx + i] !== hash[i]) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** 模块级 JWKS 缓存：iss → { keys, expiresAt }，避免每次请求都回源。 */
const jwksCache = new Map<string, { keys: JwkKeys; expiresAt: number }>();

/** 回源并解析 JWKS；forceRefresh 跳过缓存（kid 未命中时的自愈路径）。 */
async function getJwks(
  issuer: string,
  { forceRefresh = false }: { forceRefresh?: boolean } = {},
): Promise<JwkKeys> {
  const iss = String(issuer).replace(/\/+$/, "");
  const cached = jwksCache.get(iss);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.keys;

  const res = await fetch(`${iss}/.well-known/jwks.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`jwks-http-${res.status}`);
  const data = (await res.json()) as { keys?: unknown };
  const keys = Array.isArray(data?.keys) ? (data.keys as JwkKeys) : null;
  if (!keys) throw new Error("jwks-shape");
  jwksCache.set(iss, { keys, expiresAt: Date.now() + JWKS_TTL_MS });
  return keys;
}

/** 响应头安全的小标签：只放行受限字符集，其余归一为 "invalid"。 */
function sanitizeTag(value: unknown): string {
  const raw = String(value ?? "");
  return /^[\w.:-]{1,32}$/.test(raw) ? raw : "invalid";
}

/** issuer 比较前的尾斜杠归一化。 */
function normalizeIssuer(value: unknown): string {
  return String(value ?? "").replace(/\/+$/, "");
}

/** azp host 是否等于 apex 或其任意子域（前导点边界匹配）。导出仅供测试。 */
export function isAllowedAzp(azp: unknown, apex: unknown): boolean {
  if (typeof azp !== "string" || typeof apex !== "string") return false;
  const host = azp
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split(/[:/?]/)[0];
  return !!host && (host === apex || host.endsWith(`.${apex}`));
}

/** verifyAgentSession 的可注入依赖（测试无需真实网络）。 */
export type AgentVerifyDeps = {
  jwks?: JwkKeys | null;
  now?: number;
  crypto?: Crypto;
  fetchJwks?: (issuer: string, opts?: { forceRefresh?: boolean }) => Promise<JwkKeys>;
  allowedIssuers?: string[];
  azpApex?: string;
};

/**
 * 验证 Clerk 会话 JWT（八步清单，见块注释）：成功 { ok: true, payload }，
 * 失败 { ok: false, reason }（进 401 响应的 x-auth-fail 诊断头，算法名经
 * sanitizeTag 消毒）。issuer 白名单默认由 azpApex 派生（clerk.<apex>）。
 * 全部依赖可注入。导出仅供测试。
 */
export async function verifyAgentSession(
  token: unknown,
  {
    jwks = null,
    now = Date.now(),
    crypto: cryptoObj = globalThis.crypto,
    fetchJwks = getJwks,
    allowedIssuers,
    azpApex = DEFAULT_SITE_APEX,
  }: AgentVerifyDeps = {},
): Promise<
  { ok: true; payload: Record<string, unknown> } | { ok: false; reason: string }
> {
  const issuers = allowedIssuers ?? [`https://clerk.${azpApex}`];
  const parsed = parseTokenPayload(token);
  if (!parsed) return { ok: false, reason: "parse" };

  // Clerk 实例间会话签名算法不固定（开发/生产实例分别为 ES256/RS256），
  // 按 header.alg 分派到与实例 JWKS 密钥型一致的算法，其余直接拒绝。
  const alg = parsed.header.alg;
  if (alg !== "ES256" && alg !== "RS256") {
    return { ok: false, reason: `alg:${sanitizeTag(alg)}` };
  }

  const payload = parsed.payload;
  // 钉死 issuer：只信任白名单实例并只回源其 JWKS（防"任意 iss + 自造
  // JWKS"伪造身份），比较前做尾斜杠归一化。
  const iss = normalizeIssuer(payload.iss);
  if (!issuers.map(normalizeIssuer).includes(iss)) {
    return { ok: false, reason: "iss" };
  }

  // azp 校验（防子域 cookie 泄漏攻击）：存在时其 host 须为本站 apex 或其
  // 任意子域；旧实例可能不带 azp，缺失时放行（对齐官方示例）。
  if (payload.azp && !isAllowedAzp(payload.azp, azpApex)) {
    return { ok: false, reason: "azp" };
  }

  // 时间窗：exp 缺失/已过期、nbf 未生效，各带 CLOCK_SKEW_S 容差。
  const nowSec = now / 1000;
  const exp = Number(payload.exp);
  if (!Number.isFinite(exp) || nowSec >= exp + CLOCK_SKEW_S) {
    return { ok: false, reason: "exp" };
  }
  const nbf = Number(payload.nbf);
  if (Number.isFinite(nbf) && nowSec < nbf - CLOCK_SKEW_S) {
    return { ok: false, reason: "nbf" };
  }
  // sts（官方可选校验）：存在但非 "active" 视为会话未就绪。
  if (payload.sts !== undefined && payload.sts !== "active") {
    return { ok: false, reason: "sts" };
  }

  // 选取公钥：注入 JWKS 时跳过网络路径；回源时 kid 未命中则强制刷新
  // 一次再试（自愈密钥轮换与陈旧缓存），仍无则拒绝。
  let keys = Array.isArray(jwks) ? jwks : await fetchJwks(iss);
  let jwk = keys.find((k) => k?.kid === parsed.header.kid);
  if (!jwk && !Array.isArray(jwks)) {
    keys = await fetchJwks(iss, { forceRefresh: true });
    jwk = keys.find((k) => k?.kid === parsed.header.kid);
  }
  if (!jwk) return { ok: false, reason: "kid" };

  // 验签分派：RS256 走上方纯 JS 实现（边缘 subtle 不支持 RSA），ES256 走
  // Web Crypto（ECDSA P-256 边缘支持良好，hash 在 verify 时指定）。
  if (alg === "RS256") {
    const ok = await verifyRs256(jwk, parsed.signingInput, parsed.signature, cryptoObj);
    return ok ? { ok: true, payload } : { ok: false, reason: "sig" };
  }
  try {
    const key = await cryptoObj.subtle.importKey(
      "jwk",
      jwk as JsonWebKey,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const ok = await cryptoObj.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      parsed.signature,
      new TextEncoder().encode(parsed.signingInput),
    );
    return ok ? { ok: true, payload } : { ok: false, reason: "sig" };
  } catch {
    // 密钥型与算法不匹配等 Web Crypto 异常一律按验签失败（401）处理。
    return { ok: false, reason: "crypto" };
  }
}

/**
 * 会话验证 + uid 提取：成功 { uid, reason: null }；失败
 * { uid: null, reason }（no-cookie / 验签失败码 / sub），reason 进 401 的
 * x-auth-fail 诊断头。apex 从 env.SITE_DOMAIN 请求时派生。
 */
export async function readAgentSessionUid(
  headers: Record<string, unknown> | undefined,
  env: Record<string, string> | undefined,
  deps: AgentVerifyDeps = {},
): Promise<{ uid: string | null; reason: string | null }> {
  const token = readCookieToken(headers);
  if (!token) return { uid: null, reason: "no-cookie" };
  const apex = deps.azpApex ?? siteApex(env?.SITE_DOMAIN) ?? DEFAULT_SITE_APEX;
  const result = await verifyAgentSession(token, { ...deps, azpApex: apex });
  if (!result.ok) return { uid: null, reason: result.reason };
  const sub = result.payload?.sub;
  return typeof sub === "string" && sub.length > 0
    ? { uid: sub, reason: null }
    : { uid: null, reason: "sub" };
}

// ---------------------------------------------------------------------------
// run 动作限速：每用户每小时 10 次（模块级内存滑动窗口）
//
// Makers agents 运行时无 KV（KV 仅边缘函数可用），配额只能存实例内存：
// 实例存活期间连续计数有效，实例重启或多实例部署时各计各的——与 KV 自身
// 的 60s 最终一致一样，只能做到近似限速（尽力而为）。失败运行同样计数。
// ---------------------------------------------------------------------------

const RUN_QUOTA_LIMIT = 10;
const RUN_QUOTA_WINDOW_MS = 3_600_000;
const runQuotaBuckets = new Map<string, number[]>();

/**
 * 滑动窗口配额：剪除过期时间戳后不足 limit 则记一笔放行；达到上限则拒绝
 * 并按最早一笔给出解禁秒数。bucket 由调用方持有（生产传 runQuotaBuckets，
 * 测试传独立 Map）。导出仅供测试。
 */
export function consumeRunQuota(
  bucket: Map<string, number[]>,
  uid: string,
  now: number,
  { limit = RUN_QUOTA_LIMIT, windowMs = RUN_QUOTA_WINDOW_MS } = {},
): { allowed: boolean; retryAfterSec: number } {
  const fresh = (bucket.get(uid) ?? []).filter((t) => now - t < windowMs);
  if (fresh.length >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((fresh[0] + windowMs - now) / 1000));
    bucket.set(uid, fresh);
    return { allowed: false, retryAfterSec };
  }
  fresh.push(now);
  bucket.set(uid, fresh);
  return { allowed: true, retryAfterSec: 0 };
}

/** Makers Agent 入口：文件路由自动映射为 POST /code-run。 */
export async function onRequest(context: AgentContext): Promise<Response> {
  const signal = context.request?.signal;
  if (signal?.aborted) {
    return json({ ok: false, error: "aborted" }, 499);
  }

  const body = (context.request?.body ?? {}) as Record<string, unknown>;
  const action = asText(body.action) || "run";

  if (action !== "run" && action !== "info" && action !== "extend" && action !== "kill") {
    return json({ ok: false, error: "invalid-action" }, 400);
  }

  // 沙箱实例按会话托管：无会话 ID 无法定位实例，直接拒绝。
  const conversationId = asText(context.conversation_id ?? "");
  if (!conversationId) {
    return json({ ok: false, error: "no-conversation" }, 400);
  }

  // 登录门控（全动作）：会话 JWT 验签通过才放行；失败附 x-auth-fail 诊断头。
  const session = await readAgentSessionUid(context.request?.headers, context.env);
  if (!session.uid) {
    return json({ ok: false, error: "unauthorized" }, 401, {
      "x-auth-fail": sanitizeTag(session.reason),
    });
  }

  const sandbox = context.sandbox ?? null;
  if (!sandbox) {
    return json({ ok: false, error: "sandbox-unavailable" }, 503);
  }

  try {
    if (action === "run") {
      const language = asText(body.language);
      if (!(LANGUAGE_IDS as readonly string[]).includes(language)) {
        return json({ ok: false, error: "invalid-language" }, 400);
      }
      const code = typeof body.code === "string" ? body.code : "";
      if (!code.trim()) return json({ ok: false, error: "invalid-code" }, 400);
      if (code.length > MAX_CODE_LEN) return json({ ok: false, error: "invalid-code" }, 400);
      const timeoutSec = clampTimeout(body.timeoutSec);
      if (timeoutSec === null) return json({ ok: false, error: "invalid-timeout" }, 400);
      const lifetimeSec = clampLifetime(body.lifetimeSec);

      // 限速：参数合法的运行才计数（失败运行同样消耗额度）。
      const quota = consumeRunQuota(runQuotaBuckets, session.uid, Date.now());
      if (!quota.allowed) {
        return json({ ok: false, error: "rate-limited" }, 429, {
          "retry-after": String(quota.retryAfterSec),
        });
      }

      // 运行前寿命检查：懒创建实例的默认寿命由 edgeone.json sandbox.timeout
      // （60s，到点自动回收）决定；extendTimeout 只有"续期"语义、无法缩短，
      // 用户选 1 分钟时依赖该默认值精确生效（历史 BUG：timeout=600 时选
      // 1 分钟实际得到约 6 分钟）。剩余寿命不足用户设定时补足差额；剩余
      // 未知（实例尚未创建）时按设定值续期并懒创建。失败不阻断本次运行
      // ——execute 会按需懒创建，真实到期时间以后端返回为准。
      try {
        const info = (await sandbox.getInfo?.()) ?? null;
        const expMs = Date.parse(asText(info?.expiresAt ?? info?.expires_at ?? ""));
        const remainingSec = Number.isFinite(expMs) ? (expMs - Date.now()) / 1000 : null;
        if (remainingSec === null || remainingSec < lifetimeSec) {
          const topUpSec = remainingSec === null
            ? lifetimeSec
            : Math.max(1, Math.ceil(lifetimeSec - remainingSec));
          await sandbox.extendTimeout?.(topUpSec);
        }
      } catch {
        // 保底续期失败不阻断运行。
      }

      const outcome = await execute(sandbox, language as LanguageId, code, timeoutSec);
      let info: Record<string, unknown> | null = null;
      try {
        info = (await sandbox.getInfo?.()) ?? null;
      } catch {
        info = null;
      }
      const snapshot = sandboxSnapshot(info);
      if (!snapshot.externalUrl) {
        const url = await externalHostUrl(sandbox);
        if (url) snapshot.externalUrl = url;
      }
      return json({ ok: true, action: "run", language, ...outcome, sandbox: snapshot });
    }

    if (action === "info") {
      const info = (await sandbox.getInfo?.()) ?? null;
      const snapshot = sandboxSnapshot(info);
      const url = await externalHostUrl(sandbox);
      if (url) snapshot.externalUrl = url;
      return json({
        ok: true,
        action: "info",
        conversationId,
        sandbox: snapshot,
      });
    }

    if (action === "extend") {
      const seconds = typeof body.seconds === "number" && Number.isFinite(body.seconds)
        ? Math.min(Math.max(Math.round(body.seconds), 1), 3600)
        : 600;
      await sandbox.extendTimeout?.(seconds);
      const info = (await sandbox.getInfo?.()) ?? null;
      return json({
        ok: true,
        action: "extend",
        sandbox: sandboxSnapshot(info),
        message: `extended by ${seconds}s`,
      });
    }

    // action === "kill"
    await sandbox.kill?.();
    return json({ ok: true, action: "kill" });
  } catch (err) {
    return json(
      { ok: false, error: "sandbox-error", message: asText(err instanceof Error ? err.message : err) },
      502,
    );
  }
}
