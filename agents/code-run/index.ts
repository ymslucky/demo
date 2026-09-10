/**
 * POST /code-run —— 代码沙箱执行端点（EdgeOne Makers Agent 运行时专属）。
 *
 * 仅在 Makers Agent 运行时可用（依赖 context.sandbox）；本地 next dev 无此
 * 路由属预期，前端会以"沙箱不可用"文案降级。沙箱实例按请求头
 * makers-conversation-id 绑定到浏览器会话：同一会话懒创建并复用同一实例，
 * 更换 ID 即得到全新沙箱（重置按钮的实现原理）。
 *
 * 动作（JSON body.action）：
 * - run    { language, code, timeoutSec? }  执行代码 → stdout/stderr/results/exitCode
 * - info   {}                               沙箱实例信息（实例 ID / 到期时间 / 外部访问地址）
 * - extend { seconds }                      续期实例（extendTimeout）
 * - kill   {}                               销毁实例（重置会话时调用）
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

const MAX_CODE_LEN = 20_000;
const DEFAULT_TIMEOUT_S = 30;
const MAX_TIMEOUT_S = 60;
const HOST_PORT = 8080;

/** 手工序列化 JSON 响应（no-store：响应随会话/实例状态变化，绝不缓存）。 */
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
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
function flattenKernelOutput(out: { results?: unknown; logs?: unknown } | null | undefined): {
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
function errorText(value: unknown): string {
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
async function execute(
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
