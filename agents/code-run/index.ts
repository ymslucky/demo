/**
 * POST /code-run —— 代码沙箱执行端点（EdgeOne Makers Agent 运行时专属）。
 *
 * 仅在 Makers Agent 运行时可用（依赖 context.sandbox）；本地 next dev 无此
 * 路由属预期，前端会以"沙箱不可用"文案降级。沙箱实例按请求头
 * makers-conversation-id 绑定到浏览器会话：同一会话懒创建并复用同一实例，
 * 更换 ID 即得到全新沙箱（重置按钮的实现原理）。
 *
 * 动作（JSON body.action）：
 * - run     { language, code, timeoutSec? } 执行代码 →
 *           stdout/stderr/results/exitCode。实例寿命不做任何隐藏续期：
 *           懒创建实例的默认寿命 = edgeone.json sandbox.timeout（60s，到点
 *           自动回收），需要更长时间时由用户显式 extend。
 * - browser { steps }                       浏览器操作队列（CDP 驱动内置
 *           Chromium，原子 API 见 context.sandbox.browser.*）：goto / click /
 *           type / evaluate / getContent / screenshot / close，逐步执行，
 *           交互步骤（goto/click/type）成功后自动补拍视口截图，任一步失败
 *           即中止（前端逐条发送队列步骤，实现实时进度回填）。
 * - info    {}                              沙箱实例信息（实例 ID / 到期时间 / 外部访问地址）
 * - extend  { seconds }                     续期实例（extendTimeout）
 * - kill    {}                              销毁实例（重置会话时调用）
 *
 * 登录门控（全动作生效）：仅登录用户可用。读取 __session cookie 中的
 * Clerk 会话 JWT 并完整验签（八步清单由 npm 包 @lucky/auth-core 的
 * verifySessionDetailed 提供——单一真源；RS256 走纯 JS BigInt 实现等
 * 算法细节见包内 verify.js），失败返回 401 unauthorized 并附
 * x-auth-fail 诊断头。本文件只保留薄包装 verifyAgentSession（注入站点
 * 默认派生）与运行时适配（普通对象 headers 读 cookie、诊断头消毒）。
 *
 * run 动作限速：每用户每小时 10 次；browser 动作独立配额每用户每小时
 * 60 次（前端逐条发送队列步骤，一次队列会消耗多条）。模块级内存滑动窗口
 * （Makers agents 运行时无 KV——KV 仅边缘函数可用；实例内存只在实例存活
 * 期间连续计数，重启或多实例部署各计各的，属尽力而为的近似限速）。参数
 * 校验通过后计数，失败运行同样消耗额度；超限返回 429 rate-limited（附
 * retry-after）。
 *
 * RBAC（basic-rbac 教程模式）：角色存于用户 publicMetadata，经 Clerk
 * Dashboard 的 session token 定制（Sessions → Customize session token：
 * metadata = user.public_metadata）注入会话 claims.metadata，随 JWT 一并
 * 签名——八步验签通过后直读 payload.metadata.role 即可信。与 admin 角色
 * 匹配则跳过全部限速（管理员不限次）。未配置 token 定制时无该 claim →
 * 一律按普通用户限速，fail-closed。配额与角色名可由环境变量覆盖：
 * SANDBOX_RUN_QUOTA / SANDBOX_BROWSER_QUOTA / SANDBOX_ADMIN_ROLE。
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
 * 除 npm 包 @lucky/auth-core（验签单一真源）外不 import 任何模块；全部
 * 类型为结构性声明，以便 next build 对 agents/** 的类型检查无需 Makers
 * SDK 依赖。
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
  browser?: {
    goto?: (
      url: string,
    ) => Promise<{ url?: unknown; title?: unknown; status?: unknown } | null | undefined>;
    click?: (selector: string) => Promise<unknown>;
    type?: (selector: string, text: string) => Promise<unknown>;
    evaluate?: (script: string) => Promise<unknown>;
    getContent?: () => Promise<{ content?: unknown } | null | undefined>;
    screenshot?: (opts?: { fullPage?: boolean }) => Promise<{ base64Image?: unknown } | null | undefined>;
    close?: () => Promise<unknown>;
    cdpUrl?: unknown;
    liveUrl?: unknown;
  };
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

// 浏览器操作队列的入参上限：步骤数与各字段长度（防御式白名单截断）。
const MAX_BROWSER_STEPS = 12;
const MAX_BROWSER_URL = 2_000;
const MAX_BROWSER_SELECTOR = 500;
const MAX_BROWSER_TEXT = 2_000;
const MAX_BROWSER_SCRIPT = 8_000;
const MAX_BROWSER_CONTENT = 20_000;

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

/** 长文本封顶加省略号（summary / content 展示用）。 */
function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
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
// 浏览器操作队列（context.sandbox.browser.*，CDP 驱动内置 Chromium）
// ---------------------------------------------------------------------------

export type BrowserStepOp =
  | "goto"
  | "click"
  | "type"
  | "evaluate"
  | "getContent"
  | "screenshot"
  | "close";

export type BrowserStep = {
  op: BrowserStepOp;
  url?: string;
  selector?: string;
  text?: string;
  script?: string;
  fullPage?: boolean;
};

export type BrowserStepResult = {
  op: BrowserStepOp;
  ok: boolean;
  summary: string;
  error: string;
  /** evaluate / getContent 的返回内容（封顶 MAX_BROWSER_CONTENT）。 */
  content?: string;
  /** 步骤截图（交互步骤自动补拍；screenshot 步骤本身即产出）。 */
  base64Image?: string;
  elapsedMs: number;
};

function isBrowserStepOp(value: unknown): value is BrowserStepOp {
  return (
    value === "goto" ||
    value === "click" ||
    value === "type" ||
    value === "evaluate" ||
    value === "getContent" ||
    value === "screenshot" ||
    value === "close"
  );
}

/**
 * body.steps 白名单化：数组（1-12 条）逐条校验 op 与必填字段（goto 要
 * url、click/type 要 selector、evaluate 要 script），字符串字段超长截断；
 * 任何结构性畸形整体拒绝（400 invalid-steps）。导出仅供测试。
 */
export function parseBrowserSteps(value: unknown): BrowserStep[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BROWSER_STEPS) {
    return null;
  }
  const steps: BrowserStep[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;
    if (!isBrowserStepOp(obj.op)) return null;
    const step: BrowserStep = { op: obj.op };
    if (typeof obj.url === "string") step.url = obj.url.slice(0, MAX_BROWSER_URL);
    if (typeof obj.selector === "string") step.selector = obj.selector.slice(0, MAX_BROWSER_SELECTOR);
    if (typeof obj.text === "string") step.text = obj.text.slice(0, MAX_BROWSER_TEXT);
    if (typeof obj.script === "string") step.script = obj.script.slice(0, MAX_BROWSER_SCRIPT);
    if (obj.fullPage === true) step.fullPage = true;
    if (step.op === "goto" && !step.url) return null;
    if ((step.op === "click" || step.op === "type") && !step.selector) return null;
    if (step.op === "evaluate" && !step.script) return null;
    steps.push(step);
  }
  return steps;
}

/**
 * 逐步执行浏览器操作队列：每步产出结果；交互步骤（goto / click / type）
 * 成功后自动补拍一张视口截图（前端"每步操作流程截图"的数据源）；任一步
 * 失败即中止（后续步骤不再执行）。导出仅供测试（注入假 browser）。
 */
export async function executeBrowserSteps(
  sandbox: SandboxLike,
  steps: BrowserStep[],
): Promise<BrowserStepResult[]> {
  const browser = sandbox.browser ?? null;
  const results: BrowserStepResult[] = [];
  for (const step of steps) {
    const startedAt = Date.now();
    let ok = true;
    let error = "";
    let summary = "";
    let content: string | undefined;
    let base64Image: string | undefined;
    try {
      if (!browser) throw new Error("browser-unavailable");
      if (step.op === "goto") {
        const out = (await browser.goto?.(step.url ?? "")) ?? {};
        const obj = out as Record<string, unknown>;
        const parts = [step.url ?? ""];
        if (typeof obj.status === "number") parts.push(`HTTP ${obj.status}`);
        const title = asText(obj.title);
        if (title) parts.push(title);
        summary = parts.join(" - ");
      } else if (step.op === "click") {
        await browser.click?.(step.selector ?? "");
        summary = step.selector ?? "";
      } else if (step.op === "type") {
        await browser.type?.(step.selector ?? "", step.text ?? "");
        summary = `${step.selector ?? ""} <= "${truncate(step.text ?? "", 60)}"`;
      } else if (step.op === "evaluate") {
        const out = await browser.evaluate?.(step.script ?? "");
        const text = asText(out);
        content = truncate(text, MAX_BROWSER_CONTENT);
        summary = truncate(text, 200);
      } else if (step.op === "getContent") {
        const out = (await browser.getContent?.()) ?? {};
        const html = asText((out as Record<string, unknown>).content);
        content = truncate(html, MAX_BROWSER_CONTENT);
        summary = `${html.length} chars`;
      } else if (step.op === "screenshot") {
        const out = (await browser.screenshot?.({ fullPage: step.fullPage === true })) ?? {};
        base64Image = asText((out as Record<string, unknown>).base64Image);
        if (!base64Image) throw new Error("empty-screenshot");
        summary = step.fullPage === true ? "full page" : "viewport";
      } else {
        await browser.close?.();
        summary = "closed";
      }
      if (step.op === "goto" || step.op === "click" || step.op === "type") {
        // 交互步骤成功后自动补拍视口截图；补拍失败静默（截图是增强信息）。
        try {
          const out = (await browser.screenshot?.({ fullPage: false })) ?? {};
          const img = asText((out as Record<string, unknown>).base64Image);
          if (img) base64Image = img;
        } catch {
          // 自动截图失败不影响步骤结果。
        }
      }
    } catch (err) {
      ok = false;
      error = errorText(err);
    }
    const result: BrowserStepResult = {
      op: step.op,
      ok,
      summary,
      error,
      elapsedMs: Date.now() - startedAt,
    };
    if (content !== undefined) result.content = content;
    if (base64Image !== undefined) result.base64Image = base64Image;
    results.push(result);
    if (!ok) break;
  }
  return results;
}

// ---------------------------------------------------------------------------
// Clerk 会话验证（验签核心单一真源：npm 包 @lucky/auth-core）
//
// 八步清单（parse → alg 分派（仅 ES256/RS256）→ 钉死 issuer 白名单 →
// azp 校验（缺失放行）→ exp/nbf（5s 容差）→ sts → kid 匹配（未命中强制
// 刷新 JWKS 一次）→ 验签）由包的 verifySessionDetailed 提供；RS256 走
// 纯 JS BigInt 实现（边缘运行时 crypto.subtle 不支持 RSA）等算法细节见
// 包内 verify.js。与 todo.js 的差异只有两处：
// - headers 是普通对象（Makers 运行时无 Headers.get），cookie 由
//   readCookieToken 直接取 headers["cookie"]；
// - issuer 白名单 / azp 基准不在模块级派生（Makers 运行时无 process.env），
//   改为请求时从 context.env.SITE_DOMAIN 派生并注入 verifyAgentSession。
// ---------------------------------------------------------------------------

import {
  ADMIN_ROLE,
  DEFAULT_SITE_APEX,
  isAllowedAzp,
  roleFromClaims,
  siteApex,
  verifySessionDetailed,
} from "@lucky/auth-core";

// 共享判定逻辑 re-export（单一真源 @lucky/auth-core，供测试与上层复用）。
export { isAllowedAzp, roleFromClaims, siteApex };

type Jwk = Record<string, unknown>;
type JwkKeys = Jwk[];

/** 从普通对象 headers 的 cookie 中提取 __session JWT（字符集 URL 安全）。 */
function readCookieToken(headers: Record<string, unknown> | undefined): string | null {
  const raw = headers?.cookie;
  const cookie =
    typeof raw === "string" ? raw : Array.isArray(raw) ? raw.join("; ") : "";
  const match = cookie.match(/(?:^|;\s*)__session=([^;]*)/);
  return match ? match[1].trim() : null;
}

/** 响应头安全的小标签：只放行受限字符集，其余归一为 "invalid"。 */
function sanitizeTag(value: unknown): string {
  const raw = String(value ?? "");
  return /^[\w.:-]{1,32}$/.test(raw) ? raw : "invalid";
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
 * 失败 { ok: false, reason }（进 401 响应的 x-auth-fail 诊断头）。八步
 * 验签由 @lucky/auth-core 的 verifySessionDetailed 提供（单一真源，含
 * alg reason 的消毒）；本薄包装只注入站点默认派生：issuer 白名单缺省
 * clerk.<azpApex>（与原 TS 实现一致），fetchJwks 缺省沿用包内带 1h 缓存
 * 的 getJwks。AgentVerifyDeps 注入字段与返回形状不变，测试无需真实网络。
 * 导出仅供测试。
 */
export async function verifyAgentSession(
  token: unknown,
  {
    jwks = null,
    now = Date.now(),
    crypto: cryptoObj = globalThis.crypto,
    fetchJwks,
    allowedIssuers,
    azpApex = DEFAULT_SITE_APEX,
  }: AgentVerifyDeps = {},
): Promise<
  { ok: true; payload: Record<string, unknown> } | { ok: false; reason: string }
> {
  return verifySessionDetailed(token, {
    ...(Array.isArray(jwks) ? { jwks } : {}),
    now,
    crypto: cryptoObj,
    ...(fetchJwks ? { fetchJwks } : {}),
    allowedIssuers: allowedIssuers ?? [`https://clerk.${azpApex}`],
    azpApex,
  });
}

/**
 * 会话验证 + uid / 角色提取：成功 { uid, role, reason: null }；失败
 * { uid: null, role: "", reason }（no-cookie / 验签失败码 / sub），reason
 * 进 401 的 x-auth-fail 诊断头。role 来自 claims.metadata.role（session
 * token 定制注入，随 JWT 签名可信；未配置时为空串）。apex 从
 * env.SITE_DOMAIN 请求时派生。
 */
export async function readAgentSessionUid(
  headers: Record<string, unknown> | undefined,
  env: Record<string, string> | undefined,
  deps: AgentVerifyDeps = {},
): Promise<{ uid: string | null; role: string; reason: string | null }> {
  const token = readCookieToken(headers);
  if (!token) return { uid: null, role: "", reason: "no-cookie" };
  const apex = deps.azpApex ?? siteApex(env?.SITE_DOMAIN) ?? DEFAULT_SITE_APEX;
  const result = await verifyAgentSession(token, { ...deps, azpApex: apex });
  if (!result.ok) return { uid: null, role: "", reason: result.reason };
  const sub = result.payload?.sub;
  return typeof sub === "string" && sub.length > 0
    ? { uid: sub, role: roleFromClaims(result.payload), reason: null }
    : { uid: null, role: "", reason: "sub" };
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

// browser 动作独立配额桶（60 次/小时，按请求数计——前端逐条发送队列步骤）。
const BROWSER_QUOTA_LIMIT = 60;
const browserQuotaBuckets = new Map<string, number[]>();

// ---------------------------------------------------------------------------
// 配额与角色策略：默认值 + 环境变量覆盖（SANDBOX_RUN_QUOTA /
// SANDBOX_BROWSER_QUOTA / SANDBOX_ADMIN_ROLE）。管理员（角色匹配 adminRole）
// 跳过全部限速。导出仅供测试。
// ---------------------------------------------------------------------------

const DEFAULT_ADMIN_ROLE = ADMIN_ROLE;

export type QuotaPolicy = {
  runLimit: number;
  browserLimit: number;
  adminRole: string;
};

function positiveInt(value: unknown, fallback: number): number {
  const n =
    typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : typeof value === "number"
        ? value
        : NaN;
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

export function resolveQuotaPolicy(env: Record<string, string> | undefined): QuotaPolicy {
  return {
    runLimit: positiveInt(env?.SANDBOX_RUN_QUOTA, RUN_QUOTA_LIMIT),
    browserLimit: positiveInt(env?.SANDBOX_BROWSER_QUOTA, BROWSER_QUOTA_LIMIT),
    adminRole: asText(env?.SANDBOX_ADMIN_ROLE).trim() || DEFAULT_ADMIN_ROLE,
  };
}

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

  if (
    action !== "run" &&
    action !== "browser" &&
    action !== "info" &&
    action !== "extend" &&
    action !== "kill"
  ) {
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

  // RBAC：角色随会话 JWT 签名下发（claims.metadata.role），管理员不限次。
  const policy = resolveQuotaPolicy(context.env);
  const isAdmin = session.role === policy.adminRole;

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

      // 限速：参数合法的运行才计数（失败运行同样消耗额度）。
      const quota = consumeRunQuota(runQuotaBuckets, session.uid, Date.now());
      if (!quota.allowed) {
        return json({ ok: false, error: "rate-limited" }, 429, {
          "retry-after": String(quota.retryAfterSec),
        });
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

    if (action === "browser") {
      if (!sandbox.browser) {
        return json({ ok: false, error: "browser-unavailable" }, 503);
      }
      const steps = parseBrowserSteps(body.steps);
      if (!steps) return json({ ok: false, error: "invalid-steps" }, 400);
      if (!isAdmin) {
        const quota = consumeRunQuota(browserQuotaBuckets, session.uid, Date.now(), {
          limit: policy.browserLimit,
        });
        if (!quota.allowed) {
          return json({ ok: false, error: "rate-limited" }, 429, {
            "retry-after": String(quota.retryAfterSec),
          });
        }
      }
      const stepResults = await executeBrowserSteps(sandbox, steps);
      // liveUrl / cdpUrl 可能是懒初始化 getter，防御式读取（失败置空）。
      let liveUrl = "";
      let cdpUrl = "";
      try {
        liveUrl = asText(sandbox.browser.liveUrl);
        cdpUrl = asText(sandbox.browser.cdpUrl);
      } catch {
        // 读取失败不阻断响应。
      }
      let info: Record<string, unknown> | null = null;
      try {
        info = (await sandbox.getInfo?.()) ?? null;
      } catch {
        info = null;
      }
      return json({
        ok: true,
        action: "browser",
        steps: stepResults,
        browser: { liveUrl, cdpUrl },
        sandbox: sandboxSnapshot(info),
      });
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
