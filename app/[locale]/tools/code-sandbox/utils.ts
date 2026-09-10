/**
 * Code Sandbox —— 纯逻辑助手（无 React / 无副作用，全部可单测）。
 *
 * 代码内容保持 CJK-free（词表走 next-intl）；注释允许中文。
 * 后端契约见 agents/code-run/index.ts：POST /code-run，
 * 动作 run / browser / info / extend / kill，会话头 makers-conversation-id。
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

/** 本地时区 YYYY-MM-DD HH:MM:SS（实例列表时间列）；非法时间戳返回 "—"。 */
export function formatDateTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "—";
  const d = new Date(ts);
  const part = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${part(d.getMonth() + 1)}-${part(d.getDate())} ${part(d.getHours())}:${part(d.getMinutes())}:${part(d.getSeconds())}`;
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

/** 实例列表条目（/api/sandboxes 返回的 KV 记录，含所属用户与生命周期）。 */
export interface SandboxInstanceRecord {
  uid: string;
  instanceId: string;
  createdAt: number;
  updatedAt: number;
  expiresAt?: string;
  externalUrl?: string;
}

/**
 * 防御式解析 /api/sandboxes 列表响应：非对象/缺 sandboxes 数组返回 null
 * （区别于合法空列表），条目缺 instanceId/uid 的丢弃，数值字段守卫。
 */
export function normalizeInstanceRecords(raw: unknown): SandboxInstanceRecord[] | null {
  if (!raw || typeof raw !== "object") return null;
  const list = (raw as Record<string, unknown>).sandboxes;
  if (!Array.isArray(list)) return null;
  const records: SandboxInstanceRecord[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const instanceId = typeof obj.instanceId === "string" ? obj.instanceId : "";
    const uid = typeof obj.uid === "string" ? obj.uid : "";
    if (!instanceId || !uid) continue;
    const createdAt = typeof obj.createdAt === "number" && Number.isFinite(obj.createdAt) ? obj.createdAt : 0;
    const updatedAt = typeof obj.updatedAt === "number" && Number.isFinite(obj.updatedAt) ? obj.updatedAt : 0;
    records.push({
      instanceId,
      uid,
      createdAt,
      updatedAt,
      expiresAt: typeof obj.expiresAt === "string" && obj.expiresAt ? obj.expiresAt : undefined,
      externalUrl: typeof obj.externalUrl === "string" && obj.externalUrl ? obj.externalUrl : undefined,
    });
  }
  return records;
}

// ---------------------------------------------------------------------------
// 实例列表表格纯逻辑（InstancesPanel 的筛选 / 排序 / 分组，导出供单测）
// ---------------------------------------------------------------------------

export type InstanceStatus = "alive" | "expired" | "unknown";

/** 状态判定：到期时间可解析且未到 → alive；已过 → expired；缺失/非法 → unknown。 */
export function instanceStatus(record: SandboxInstanceRecord, now: number): InstanceStatus {
  if (!record.expiresAt) return "unknown";
  const time = Date.parse(record.expiresAt);
  if (!Number.isFinite(time)) return "unknown";
  return time > now ? "alive" : "expired";
}

/** 实例筛选条件（字段全部可选；date 值为 YYYY-MM-DD 字符串，含当日）。 */
export interface InstanceFilter {
  text?: string;
  status?: InstanceStatus | "all";
  createdFrom?: string;
  createdTo?: string;
}

/**
 * date 输入值 → 本地时区毫秒闭区间；空/非法返回 null（不限制）。
 * to 端补足到当日 23:59:59.999。
 */
export function parseDayRange(
  fromValue?: string,
  toValue?: string,
): { from: number | null; to: number | null } {
  const parseDay = (value?: string): number | null => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [y, m, d] = value.split("-").map(Number);
    const time = new Date(y, m - 1, d).getTime();
    return Number.isFinite(time) ? time : null;
  };
  const from = parseDay(fromValue);
  const toRaw = parseDay(toValue);
  const to = toRaw === null ? null : toRaw + 24 * 60 * 60 * 1000 - 1;
  return { from, to };
}

/** 本地筛选：文本匹配 instanceId/uid（大小写不敏感子串），状态精确，创建日期闭区间。 */
export function filterInstances(
  records: SandboxInstanceRecord[],
  filter: InstanceFilter,
  now: number,
): SandboxInstanceRecord[] {
  const text = filter.text?.trim().toLowerCase() ?? "";
  const range = parseDayRange(filter.createdFrom, filter.createdTo);
  return records.filter((record) => {
    if (
      text &&
      !record.instanceId.toLowerCase().includes(text) &&
      !record.uid.toLowerCase().includes(text)
    ) {
      return false;
    }
    if (filter.status && filter.status !== "all" && instanceStatus(record, now) !== filter.status) {
      return false;
    }
    if (range.from !== null && record.createdAt < range.from) return false;
    if (range.to !== null && record.createdAt > range.to) return false;
    return true;
  });
}

export type InstanceSortKey = "instanceId" | "uid" | "createdAt" | "updatedAt" | "expiresAt";
export type SortDirection = "asc" | "desc";

/**
 * 排序（不修改入参）：字符串列 localeCompare，时间列数值比较；expiresAt
 * 缺失/非法的记录恒排最后（与方向无关），便于一眼找出残缺档案。
 */
export function sortInstances(
  records: SandboxInstanceRecord[],
  key: InstanceSortKey,
  dir: SortDirection = "asc",
): SandboxInstanceRecord[] {
  const factor = dir === "desc" ? -1 : 1;
  return [...records].sort((a, b) => {
    if (key === "instanceId" || key === "uid") return a[key].localeCompare(b[key]) * factor;
    if (key === "createdAt" || key === "updatedAt") return (a[key] - b[key]) * factor;
    const av = a.expiresAt ? Date.parse(a.expiresAt) : NaN;
    const bv = b.expiresAt ? Date.parse(b.expiresAt) : NaN;
    if (Number.isNaN(av) && Number.isNaN(bv)) return 0;
    if (Number.isNaN(av)) return 1;
    if (Number.isNaN(bv)) return -1;
    return (av - bv) * factor;
  });
}

export type InstanceGroupKey = "none" | "uid" | "status";

export interface InstanceGroup {
  /** 组标识：uid 组为用户 ID，status 组为状态枚举值，none 为空字符串。 */
  key: string;
  records: SandboxInstanceRecord[];
}

/** 分组（组内保持传入顺序，组按首次出现顺序）；none 返回单组。 */
export function groupInstances(
  records: SandboxInstanceRecord[],
  key: InstanceGroupKey,
  now: number,
): InstanceGroup[] {
  if (key === "none") return [{ key: "", records }];
  const groups = new Map<string, SandboxInstanceRecord[]>();
  for (const record of records) {
    const groupKey = key === "uid" ? record.uid : instanceStatus(record, now);
    const bucket = groups.get(groupKey);
    if (bucket) bucket.push(record);
    else groups.set(groupKey, [record]);
  }
  return [...groups.entries()].map(([groupKey, rs]) => ({ key: groupKey, records: rs }));
}

/** 剩余寿命展示："4m 30s"、"45s"、不足 1s 为 "<1s"、非正数为 "0s"。 */
export function formatRemainingMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  if (ms < 1000) return "<1s";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ---------------------------------------------------------------------------
// 浏览器工作台纯逻辑（BrowserPanel 的指令队列，导出供单测）
// ---------------------------------------------------------------------------

export type BrowserStepOp =
  | "goto"
  | "click"
  | "type"
  | "evaluate"
  | "getContent"
  | "screenshot"
  | "close";

export const BROWSER_STEP_OPS: readonly BrowserStepOp[] = [
  "goto",
  "click",
  "type",
  "evaluate",
  "getContent",
  "screenshot",
  "close",
];

/** 队列步骤（编辑态：字段全量保留，发送时后端按 op 校验必填项）。 */
export interface BrowserStep {
  id: string;
  op: BrowserStepOp;
  url: string;
  selector: string;
  text: string;
  script: string;
  fullPage: boolean;
}

export const BROWSER_STORAGE_KEY = "lucky-sandbox-browser-steps-v1";

/** 新建空白步骤（随机 id 供 React key 与结果回填定位）。 */
export function makeBrowserStep(op: BrowserStepOp, seed: string = randomId()): BrowserStep {
  return { id: seed, op, url: "", selector: "", text: "", script: "", fullPage: false };
}

export function isBrowserStepOp(value: unknown): value is BrowserStepOp {
  return (BROWSER_STEP_OPS as readonly unknown[]).includes(value);
}

/** 步骤是否满足必填字段（goto 要 url、click/type 要 selector、evaluate 要 script）。 */
export function browserStepReady(step: BrowserStep): boolean {
  if (step.op === "goto") return step.url.trim() !== "";
  if (step.op === "click" || step.op === "type") return step.selector.trim() !== "";
  if (step.op === "evaluate") return step.script.trim() !== "";
  return true;
}

/** 队列行展示参数：goto→url；click→selector；type→selector|text；evaluate→脚本首行。 */
export function browserStepArg(step: BrowserStep): string {
  if (step.op === "goto") return step.url;
  if (step.op === "click") return step.selector;
  if (step.op === "type") return `${step.selector} | ${step.text}`;
  if (step.op === "evaluate") {
    const firstLine = (step.script.split("\n").find((line) => line.trim() !== "") ?? "").trim();
    return firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;
  }
  return "";
}

/** 重组步骤（不修改入参）；越界（首行上移 / 末行下移）返回原数组。 */
export function moveBrowserStep(steps: BrowserStep[], id: string, delta: -1 | 1): BrowserStep[] {
  const index = steps.findIndex((step) => step.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= steps.length) return steps;
  const next = [...steps];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function removeBrowserStep(steps: BrowserStep[], id: string): BrowserStep[] {
  return steps.filter((step) => step.id !== id);
}

/**
 * 防御式解析 localStorage 中的队列：非数组返回 null；条目逐个校验（op
 * 合法、字段为字符串），畸形单条丢弃而非整体失败。
 */
export function normalizeBrowserSteps(raw: unknown): BrowserStep[] | null {
  if (!Array.isArray(raw)) return null;
  const steps: BrowserStep[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    if (!isBrowserStepOp(obj.op)) continue;
    steps.push({
      id: typeof obj.id === "string" && obj.id ? obj.id : randomId(),
      op: obj.op,
      url: typeof obj.url === "string" ? obj.url : "",
      selector: typeof obj.selector === "string" ? obj.selector : "",
      text: typeof obj.text === "string" ? obj.text : "",
      script: typeof obj.script === "string" ? obj.script : "",
      fullPage: obj.fullPage === true,
    });
  }
  return steps;
}

/** 单步执行结果（/code-run browser 动作返回的 steps 元素）。 */
export interface BrowserStepResult {
  op: string;
  ok: boolean;
  summary: string;
  error: string;
  content?: string;
  base64Image?: string;
  elapsedMs: number;
}

export interface BrowserPayload {
  ok: boolean;
  steps: BrowserStepResult[];
  liveUrl: string;
  sandbox: SandboxSnapshot;
  error: string;
}

/** 防御式解析 browser 动作响应（畸形返回 null，交 UI 展示 invalidResponse）。 */
export function normalizeBrowserPayload(raw: unknown): BrowserPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const listRaw = obj.steps;
  if (!Array.isArray(listRaw)) return null;
  const steps: BrowserStepResult[] = [];
  for (const entry of listRaw) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    steps.push({
      op: typeof item.op === "string" ? item.op : "",
      ok: item.ok === true,
      summary: typeof item.summary === "string" ? item.summary : "",
      error: typeof item.error === "string" ? item.error : "",
      content: typeof item.content === "string" ? item.content : undefined,
      base64Image: typeof item.base64Image === "string" ? item.base64Image : undefined,
      elapsedMs:
        typeof item.elapsedMs === "number" && Number.isFinite(item.elapsedMs) ? item.elapsedMs : 0,
    });
  }
  const sandboxRaw = (
    obj.sandbox && typeof obj.sandbox === "object" ? obj.sandbox : {}
  ) as Record<string, unknown>;
  const browserRaw = (
    obj.browser && typeof obj.browser === "object" ? obj.browser : {}
  ) as Record<string, unknown>;
  return {
    ok: obj.ok === true,
    steps,
    liveUrl: typeof browserRaw.liveUrl === "string" ? browserRaw.liveUrl : "",
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
