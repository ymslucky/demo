/**
 * Code Sandbox —— 纯逻辑助手（无 React / 无副作用，全部可单测）。
 *
 * 代码内容保持 CJK-free（词表走 next-intl）；注释允许中文。
 * 后端契约见 agents/code-run/index.ts：POST /code-run，
 * 动作 run / info / extend / kill，会话头 makers-conversation-id。
 */

export type LanguageId = "python" | "javascript" | "bash" | "go" | "java";

/** 运行环境：kernel = Jupyter 内核；shell = 直接跑命令；toolchain = 写源文件后调编译工具链。 */
export type LanguageRuntime = "kernel" | "shell" | "toolchain";

export interface LanguageDef {
  id: LanguageId;
  runtime: LanguageRuntime;
  sample: string;
}

export const LANGUAGES: readonly LanguageDef[] = [
  {
    id: "python",
    runtime: "kernel",
    sample: 'name = "EdgeOne"\nprint(f"Hello from {name}!")\nfor i in range(3):\n    print("tick", i)\n',
  },
  {
    id: "javascript",
    runtime: "kernel",
    sample: 'const nums = [1, 2, 3, 4];\nconst sum = nums.reduce((a, b) => a + b, 0);\nconsole.log("sum =", sum);\nnums.map((n) => n * n);\n',
  },
  {
    id: "bash",
    runtime: "shell",
    sample: 'echo "hello from bash"\ndate\nuname -a\n',
  },
  {
    id: "go",
    runtime: "toolchain",
    sample: 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("hello from Go")\n}\n',
  },
  {
    id: "java",
    runtime: "toolchain",
    sample: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("hello from Java");\n    }\n}\n',
  },
];

export const MIN_RUN_TIMEOUT_S = 5;
export const MAX_RUN_TIMEOUT_S = 60;
export const DEFAULT_RUN_TIMEOUT_S = 30;
export const MAX_CODE_LEN = 20_000;
export const MAX_CONSOLE_ENTRIES = 400;
export const MAX_RUN_HISTORY = 30;

/** localStorage 键：编辑器内容与会话 ID（会话 ID 换新 = 新沙箱实例）。 */
export const CODE_STORAGE_KEY = "lucky-sandbox-code-v1";
export const CONVERSATION_KEY = "lucky-sandbox-conversation-v1";

export function isLanguageId(value: unknown): value is LanguageId {
  return LANGUAGES.some((lang) => lang.id === value);
}

export function sanitizeLanguage(value: unknown, fallback: LanguageId): LanguageId {
  return isLanguageId(value) ? value : fallback;
}

export function languageDef(id: LanguageId): LanguageDef {
  return LANGUAGES.find((lang) => lang.id === id) ?? LANGUAGES[0];
}

/** 超时秒数：非法值回退默认值，合法值 clamp 到 [MIN, MAX]。 */
export function clampTimeoutSec(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_RUN_TIMEOUT_S;
  return Math.min(Math.max(Math.round(value), MIN_RUN_TIMEOUT_S), MAX_RUN_TIMEOUT_S);
}

/** 代码长度封顶，超长截断（服务端同样限制 MAX_CODE_LEN）。 */
export function normalizeCode(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.length > MAX_CODE_LEN ? value.slice(0, MAX_CODE_LEN) : value;
}

/** 最小 Storage 接口（便于单测注入假实现）。 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultRandomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getOrCreateConversationId(
  store: StorageLike,
  key: string,
  randomId: () => string = defaultRandomId,
): string {
  const existing = store.getItem(key);
  if (existing) return existing;
  const fresh = randomId();
  store.setItem(key, fresh);
  return fresh;
}

export function rotateConversationId(
  store: StorageLike,
  key: string,
  randomId: () => string = defaultRandomId,
): string {
  const fresh = randomId();
  store.setItem(key, fresh);
  return fresh;
}

/** 后端返回的沙箱实例快照（信息面板数据）。 */
export interface SandboxSnapshot {
  instanceId?: string;
  expiresAt?: string;
  externalUrl?: string;
}

export interface RunOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
  results: string[];
  error: string;
  elapsedMs: number;
}

export interface RunPayload {
  ok: boolean;
  language: string;
  outcome: RunOutcome;
  sandbox: SandboxSnapshot;
  error: string;
}

/** Jupyter results 可能是字符串或富对象，统一展平为可展示文本。 */
function stringifyResult(item: unknown): string {
  if (typeof item === "string") return item;
  if (item === null || item === undefined) return "";
  if (typeof item === "object") {
    const obj = item as Record<string, unknown>;
    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.plainText === "string") return obj.plainText;
    if (typeof obj.markdown === "string") return obj.markdown;
  }
  try {
    return JSON.stringify(item) ?? "";
  } catch {
    return String(item);
  }
}

/** 防御式解析后端 run 响应（畸形响应不抛错，交给 UI 展示 invalidResponse）。 */
export function normalizeRunPayload(raw: unknown): RunPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const sandboxRaw = (
    obj.sandbox && typeof obj.sandbox === "object" ? obj.sandbox : {}
  ) as Record<string, unknown>;
  const exitRaw = obj.exitCode;
  const results = Array.isArray(obj.results)
    ? obj.results.map(stringifyResult).filter((text) => text.length > 0)
    : [];
  return {
    ok: obj.ok === true,
    language: typeof obj.language === "string" ? obj.language : "",
    outcome: {
      // exitCode 必须是数字：Number(null) === 0 会把失败伪装成功。
      exitCode:
        typeof exitRaw === "number" && Number.isFinite(exitRaw) ? exitRaw : obj.ok === true ? 0 : 1,
      stdout: typeof obj.stdout === "string" ? obj.stdout : "",
      stderr: typeof obj.stderr === "string" ? obj.stderr : "",
      results,
      error: typeof obj.error === "string" ? obj.error : "",
      elapsedMs:
        typeof obj.elapsedMs === "number" && Number.isFinite(obj.elapsedMs) ? obj.elapsedMs : 0,
    },
    sandbox: {
      instanceId:
        typeof sandboxRaw.instanceId === "string" && sandboxRaw.instanceId
          ? sandboxRaw.instanceId
          : undefined,
      expiresAt:
        typeof sandboxRaw.expiresAt === "string" && sandboxRaw.expiresAt
          ? sandboxRaw.expiresAt
          : undefined,
      externalUrl:
        typeof sandboxRaw.externalUrl === "string" && sandboxRaw.externalUrl
          ? sandboxRaw.externalUrl
          : undefined,
    },
    error: typeof obj.error === "string" ? obj.error : "",
  };
}

/** 到期时间的剩余毫秒；无法解析时返回 null。 */
export function remainingMs(expiresAt: string | undefined, now: number): number | null {
  if (!expiresAt) return null;
  const time = Date.parse(expiresAt);
  if (!Number.isFinite(time)) return null;
  return Math.max(time - now, 0);
}

/** 运行耗时展示（秒，两位小数）。 */
export function formatElapsedSeconds(ms: number): string {
  return (ms / 1000).toFixed(2);
}

export type ConsoleKind = "system" | "stdout" | "stderr" | "result" | "error";

export interface ConsoleEntry {
  id: string;
  kind: ConsoleKind;
  text: string;
  at: number;
}

export function randomId(): string {
  return defaultRandomId();
}

export function makeEntry(
  kind: ConsoleKind,
  text: string,
  at: number,
  seed: string = defaultRandomId(),
): ConsoleEntry {
  return { id: `${at.toString(36)}-${seed}`, kind, text, at };
}

/** 追加控制台条目并封顶（防长输出撑爆 DOM）。 */
export function appendEntries(list: ConsoleEntry[], incoming: ConsoleEntry[]): ConsoleEntry[] {
  const merged = [...list, ...incoming];
  return merged.length > MAX_CONSOLE_ENTRIES
    ? merged.slice(merged.length - MAX_CONSOLE_ENTRIES)
    : merged;
}

/** 单次运行记录（历史列表 + 终端回放快照 + 代码回填）。 */
export interface RunRecord {
  id: string;
  language: LanguageId;
  at: number;
  ok: boolean;
  elapsedMs: number | null;
  exitCode: number | null;
  code: string;
  output: ConsoleEntry[];
}

/** 插入最新记录到队首并封顶（历史列表最新在上）。 */
export function appendRuns(list: RunRecord[], record: RunRecord): RunRecord[] {
  const merged = [record, ...list];
  return merged.length > MAX_RUN_HISTORY ? merged.slice(0, MAX_RUN_HISTORY) : merged;
}

/** 24 小时制 HH:MM:SS（历史列表时间列）。 */
export function formatClock(ts: number): string {
  const d = new Date(ts);
  const part = (n: number) => String(n).padStart(2, "0");
  return `${part(d.getHours())}:${part(d.getMinutes())}:${part(d.getSeconds())}`;
}
