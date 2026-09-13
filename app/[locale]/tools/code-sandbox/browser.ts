/**
 * Code Sandbox —— 浏览器工作台域纯逻辑（BrowserPanel 的指令队列，导出供
 * 单测）。从 utils.ts 拆出（关注点分离）：本文件只关心“浏览器指令怎么
 * 编排/校验/解析响应”，运行时类型 SandboxSnapshot 与随机 id 仍归 utils.ts。
 * 代码内容保持 CJK-free（词表走 next-intl）；注释允许中文。
 */

import { randomId, type SandboxSnapshot } from "./utils";

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
  /** 画布节点坐标（可选；缺省时按索引生成网格默认位）。 */
  x?: number;
  y?: number;
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
      x: typeof obj.x === "number" && Number.isFinite(obj.x) && obj.x >= 0 ? obj.x : undefined,
      y: typeof obj.y === "number" && Number.isFinite(obj.y) && obj.y >= 0 ? obj.y : undefined,
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
/**
 * Duplicate a step in place: a fresh-id copy is inserted directly after
 * the original (identity no-op when the id is unknown).
 */
export function duplicateBrowserStep(steps: BrowserStep[], id: string): BrowserStep[] {
  const index = steps.findIndex((step) => step.id === id);
  if (index === -1) return steps;
  const copy = { ...steps[index], id: randomId() };
  return [...steps.slice(0, index + 1), copy, ...steps.slice(index + 1)];
}
// ---------------------------------------------------------------------------
// Canvas model：步进节点的空间布局（自由拖拽定位 + 顺序连接线）。
// 执行顺序仍是数组顺序；坐标只影响空间布局，随步骤持久化。
// ---------------------------------------------------------------------------

export const NODE_W = 232;
export const NODE_H = 96;
export const CANVAS_MARGIN = 24;

/**
 * 节点坐标：持久化过 x/y 的用原值；否则按索引生成 3 列网格默认位，
 * 旧数据（无坐标）零迁移成本地接入画布。
 */
export function nodePosition(step: BrowserStep, index: number): { x: number; y: number } {
  if (typeof step.x === "number" && typeof step.y === "number") {
    return { x: step.x, y: step.y };
  }
  const col = index % 3;
  const row = Math.floor(index / 3);
  return {
    x: CANVAS_MARGIN + col * (NODE_W + 28),
    y: CANVAS_MARGIN + row * (NODE_H + 24),
  };
}

/** 移动节点到 (x, y)：坐标钳制为非负整数；数组顺序（执行序）不变。 */
export function moveStepTo(steps: BrowserStep[], id: string, x: number, y: number): BrowserStep[] {
  const cx = Math.max(0, Math.round(x));
  const cy = Math.max(0, Math.round(y));
  return steps.map((step) => (step.id === id ? { ...step, x: cx, y: cy } : step));
}

/** 画布内容尺寸：包裹全部节点再加余量（保证滚动能到达任意节点）。 */
export function canvasSize(steps: BrowserStep[]): { width: number; height: number } {
  let width = 800;
  let height = 480;
  steps.forEach((step, index) => {
    const { x, y } = nodePosition(step, index);
    width = Math.max(width, x + NODE_W + CANVAS_MARGIN);
    height = Math.max(height, y + NODE_H + CANVAS_MARGIN);
  });
  return { width, height };
}
