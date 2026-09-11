"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "../../components/ui";
import { useStickyState } from "../components/useStickyState";
import { cardStyle, controlStyle, monoStyle, mutedStyle } from "@/app/lib/styles";
import {
  BROWSER_STEP_OPS,
  BROWSER_STORAGE_KEY,
  browserStepArg,
  browserStepReady,
  makeBrowserStep,
  moveBrowserStep,
  normalizeBrowserPayload,
  normalizeBrowserSteps,
  removeBrowserStep,
  type BrowserStep,
  type BrowserStepOp,
  type BrowserStepResult,
} from "./browser";
import { randomId, type SandboxSnapshot } from "./utils";

/**
 * 浏览器工作台子页：自定义编排浏览器操作指令队列（goto / click / type /
 * evaluate / getContent / screenshot / close），逐步发送到 /code-run 的
 * browser 动作（每步一个请求），结果与截图随步骤实时回填。纯逻辑（队列
 * 操作 / 响应解析）在 browser.ts（含单测），本组件只负责展示与交互。
 */

// 面板壳：基础卡 + grid 纵向布置 + 吃满父网格剩余高度（行不被 stretch 撑坏）。
const panelStyle = {
  ...cardStyle,
  display: "grid",
  gap: "var(--space-sm)",
  minHeight: 0,
} as const;

// 队列行小操作钮（上移 / 下移 / 删除）：重置 UA 样式，紧凑方块。
const smallBtnStyle = {
  fontFamily: "inherit",
  fontSize: "var(--fs-sm)",
  fontWeight: 800,
  lineHeight: 1,
  padding: "0.3rem 0.45rem",
  border: "2px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
  cursor: "pointer",
} as const;

// 队列主按钮：可点时切换查看器到该步截图（含序号 / 操作 / 参数 / 结果）。
const queueMainStyle = (clickable: boolean) =>
  ({
    fontFamily: "inherit",
    display: "flex",
    alignItems: "center",
    gap: "var(--space-xs)",
    flex: 1,
    minWidth: 0,
    padding: "0.4rem 0.6rem",
    border: "2px solid var(--color-border)",
    borderRadius: "var(--radius-sm)",
    fontSize: "var(--fs-sm)",
    textAlign: "left",
    background: "var(--color-bg)",
    color: "var(--color-text)",
    cursor: clickable ? "pointer" : "default",
  }) as const;

const queueItemStyle = (active: boolean) =>
  ({
    display: "flex",
    alignItems: "stretch",
    gap: "var(--space-xs)",
    padding: "0.15rem",
    border: active ? "3px solid var(--color-primary)" : "3px solid transparent",
    borderRadius: "var(--radius-sm)",
    background: active ? "var(--color-tint)" : "transparent",
  }) as const;

const stepIndexBadgeStyle = {
  flexShrink: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: "1.4rem",
  padding: "0.05rem 0.25rem",
  border: "2px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  fontSize: "var(--fs-xs)",
  fontWeight: 800,
  background: "var(--color-tint-strong)",
} as const;

const resultBadgeStyle = (ok: boolean) =>
  ({
    flexShrink: 0,
    border: "2px solid var(--color-border)",
    borderRadius: "var(--radius-sm)",
    padding: "0.05rem 0.4rem",
    fontSize: "var(--fs-xs)",
    fontWeight: 800,
    background: ok ? "var(--color-info-bg)" : "var(--color-err-bg)",
    color: ok ? "var(--color-info-text)" : "var(--color-err-text)",
    whiteSpace: "nowrap",
  }) as const;

// 主区两列：左指令队列（+编排器），右截图查看器；窄屏自动单列。
const browserAreaStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))",
  gridAutoRows: "minmax(0, 1fr)",
  gap: "var(--space-md)",
  minHeight: 0,
} as const;

// 截图展示：白底防暗色主题透底，宽度铺满等比缩放。
const shotStyle = {
  width: "100%",
  height: "auto",
  display: "block",
  border: "3px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  background: "#fff",
} as const;

const opLabelKey = (op: BrowserStepOp): string =>
  op === "goto"
    ? "browserOpGoto"
    : op === "click"
      ? "browserOpClick"
      : op === "type"
        ? "browserOpType"
        : op === "evaluate"
          ? "browserOpEvaluate"
          : op === "getContent"
            ? "browserOpGetContent"
            : op === "screenshot"
              ? "browserOpScreenshot"
              : "browserOpClose";

type BrowserPanelProps = {
  conversationId: string;
  post: (body: Record<string, unknown>, convId: string) => Promise<Response>;
  mergeSnapshot: (incoming: SandboxSnapshot) => void;
  reportSandbox: (
    instanceId: string,
    payload: { expiresAt?: string; externalUrl?: string } | null,
  ) => void;
};

/** 队列执行结果：按步骤 id 回填（队列编辑后旧结果自然失配隐藏）。 */
type QueueResult = { stepId: string; result: BrowserStepResult };

export default function BrowserPanel({ conversationId, post, mergeSnapshot, reportSandbox }: BrowserPanelProps) {
  const t = useTranslations("tools.sandbox");
  const [stored, setStored] = useStickyState<unknown[]>([], BROWSER_STORAGE_KEY);
  const steps = useMemo(() => normalizeBrowserSteps(stored) ?? [], [stored]);
  const [draft, setDraft] = useState<BrowserStep>(() => makeBrowserStep("goto"));
  const [results, setResults] = useState<QueueResult[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [viewShotId, setViewShotId] = useState<string | null>(null);
  const [liveUrl, setLiveUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resultFor = (stepId: string): BrowserStepResult | undefined =>
    results.find((item) => item.stepId === stepId)?.result;

  // 查看器默认跟随最新一张截图；点击队列行（有截图的步骤）可切换回看。
  const latestShotId = useMemo(() => {
    for (let i = results.length - 1; i >= 0; i -= 1) {
      if (results[i].result.base64Image) return results[i].stepId;
    }
    return null;
  }, [results]);
  const shotStepId = viewShotId ?? latestShotId;
  const shotStep = steps.find((step) => step.id === shotStepId) ?? null;
  const shot = resultFor(shotStepId ?? "")?.base64Image;

  function addStep() {
    setStored((prev) => [...(normalizeBrowserSteps(prev) ?? []), { ...draft, id: randomId() }]);
    // 清空草稿字段但保留操作类型，便于连续添加同类步骤。
    setDraft((prev) => ({ ...makeBrowserStep(prev.op), id: prev.id }));
  }

  function clearQueue() {
    setStored([]);
    setResults([]);
    setViewShotId(null);
    setError(null);
  }

  async function runQueue() {
    if (busy || !conversationId || steps.length === 0) return;
    setBusy(true);
    setError(null);
    setResults([]);
    setViewShotId(null);
    const collected: QueueResult[] = [];
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      setActiveIndex(index);
      try {
        // 逐条发送：每步一个请求，结果与截图实时回填到队列与查看器。
        const res = await post(
          {
            action: "browser",
            steps: [
              {
                op: step.op,
                url: step.url,
                selector: step.selector,
                text: step.text,
                script: step.script,
                fullPage: step.fullPage,
              },
            ],
          },
          conversationId,
        );
        const raw: unknown = await res.json().catch(() => null);
        const payload = normalizeBrowserPayload(raw);
        if (!payload) {
          setError(t("invalidResponse"));
          break;
        }
        if (!res.ok || !payload.ok) {
          // 服务端错误码 → 可读文案：401 未登录 / 429 限速 / 503 无浏览器能力优先映射。
          const detail =
            payload.error === "unauthorized"
              ? t("runUnauthorized")
              : payload.error === "rate-limited"
                ? t("runLimited")
                : payload.error === "sandbox-unavailable" || payload.error === "browser-unavailable"
                  ? t("browserUnavailable")
                  : payload.error === "invalid-steps"
                    ? t("invalidResponse")
                    : payload.error;
          setError(
            detail
              ? `${t("runFailed", { code: res.status })}\n${detail}`
              : t("runFailed", { code: res.status }),
          );
          break;
        }
        setLiveUrl(payload.liveUrl);
        mergeSnapshot(payload.sandbox);
        if (payload.sandbox.instanceId) {
          void reportSandbox(payload.sandbox.instanceId, {
            expiresAt: payload.sandbox.expiresAt,
            externalUrl: payload.sandbox.externalUrl,
          });
        }
        const result = payload.steps[0];
        if (!result) break;
        collected.push({ stepId: step.id, result });
        setResults([...collected]);
        if (!result.ok) break;
      } catch {
        setError(t("runNetworkError"));
        break;
      }
    }
    setActiveIndex(null);
    setBusy(false);
  }

  return (
    <div style={browserAreaStyle}>
      <section style={cardStyle} aria-label={t("browserQueueTitle")}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: "var(--fs-xl)" }}>{t("browserQueueTitle")}</h2>
          <span style={mutedStyle}>{t("browserStepCount", { count: steps.length })}</span>
          <div style={{ display: "flex", gap: "var(--space-xs)", marginLeft: "auto" }}>
            <Button variant="primary" onClick={runQueue} disabled={busy || !conversationId || steps.length === 0}>
              {busy ? t("browserRunning") : t("browserRun")}
            </Button>
            <Button onClick={clearQueue} disabled={busy || steps.length === 0}>
              {t("browserClear")}
            </Button>
          </div>
        </div>

        {/* 步骤编排器：操作类型 + 按类型渲染的参数字段 + 添加 */}
        <div role="group" aria-label={t("browserAddStep")} style={{ display: "grid", gap: "var(--space-xs)" }}>
          <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap", alignItems: "center" }}>
            <label htmlFor="browser-draft-op" style={{ ...mutedStyle, fontWeight: 800 }}>
              {t("browserOpLabel")}
            </label>
            <select
              id="browser-draft-op"
              value={draft.op}
              style={{ ...controlStyle, cursor: "pointer" }}
              onChange={(event) => setDraft((prev) => ({ ...prev, op: event.target.value as BrowserStepOp }))}
            >
              {BROWSER_STEP_OPS.map((op) => (
                <option key={op} value={op}>
                  {t(opLabelKey(op))}
                </option>
              ))}
            </select>
            <Button onClick={addStep} disabled={busy || !browserStepReady(draft)}>
              {t("browserAddStep")}
            </Button>
          </div>
          {draft.op === "goto" ? (
            <input
              type="url"
              value={draft.url}
              onChange={(event) => setDraft((prev) => ({ ...prev, url: event.target.value }))}
              placeholder="https://example.com"
              aria-label={t("browserUrlLabel")}
              style={controlStyle}
            />
          ) : null}
          {draft.op === "click" || draft.op === "type" ? (
            <input
              type="text"
              value={draft.selector}
              onChange={(event) => setDraft((prev) => ({ ...prev, selector: event.target.value }))}
              placeholder="button[type=submit]"
              aria-label={t("browserSelectorLabel")}
              style={{ ...controlStyle, ...monoStyle }}
            />
          ) : null}
          {draft.op === "type" ? (
            <input
              type="text"
              value={draft.text}
              onChange={(event) => setDraft((prev) => ({ ...prev, text: event.target.value }))}
              aria-label={t("browserTextLabel")}
              style={controlStyle}
            />
          ) : null}
          {draft.op === "evaluate" ? (
            <textarea
              value={draft.script}
              onChange={(event) => setDraft((prev) => ({ ...prev, script: event.target.value }))}
              spellCheck={false}
              aria-label={t("browserScriptLabel")}
              style={{ ...controlStyle, ...monoStyle, minHeight: 96, resize: "vertical" }}
            />
          ) : null}
          {draft.op === "screenshot" ? (
            <label style={{ ...mutedStyle, display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
              <input
                type="checkbox"
                checked={draft.fullPage}
                onChange={(event) => setDraft((prev) => ({ ...prev, fullPage: event.target.checked }))}
              />
              {t("browserFullPageLabel")}
            </label>
          ) : null}
        </div>

        {error ? (
          <p style={{ ...mutedStyle, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{error}</p>
        ) : null}

        {steps.length === 0 ? (
          <div style={mutedStyle}>{t("browserQueueEmpty")}</div>
        ) : (
          <ol
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gap: "var(--space-xs)",
              alignContent: "start",
              minHeight: 0,
              overflowY: "auto",
            }}
          >
            {steps.map((step, index) => {
              const result = resultFor(step.id);
              const hasShot = Boolean(result?.base64Image);
              return (
                <li key={step.id} style={queueItemStyle(activeIndex === index)}>
                  <button
                    type="button"
                    style={queueMainStyle(hasShot)}
                    disabled={!hasShot}
                    onClick={() => setViewShotId(step.id)}
                    title={result?.content}
                  >
                    <span style={stepIndexBadgeStyle} aria-hidden="true">
                      {index + 1}
                    </span>
                    <span style={{ fontWeight: 800, whiteSpace: "nowrap" }}>{t(opLabelKey(step.op))}</span>
                    {browserStepArg(step) ? (
                      <span style={{ ...monoStyle, ...mutedStyle, wordBreak: "break-all" }}>
                        {browserStepArg(step)}
                      </span>
                    ) : null}
                    {result ? (
                      <span style={resultBadgeStyle(result.ok)} aria-hidden="true">
                        {result.ok ? "✓" : "✗"}
                      </span>
                    ) : null}
                    {result && !result.ok && result.error ? (
                      <span style={{ ...mutedStyle, color: "var(--color-err-text)", wordBreak: "break-word" }}>
                        {result.error}
                      </span>
                    ) : null}
                    {result?.summary ? (
                      <span style={{ ...mutedStyle, marginLeft: "auto", whiteSpace: "nowrap" }}>
                        {result.summary}
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    style={smallBtnStyle}
                    aria-label={t("browserMoveUp")}
                    disabled={busy || index === 0}
                    onClick={() =>
                      setStored((prev) => moveBrowserStep(normalizeBrowserSteps(prev) ?? [], step.id, -1))
                    }
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    style={smallBtnStyle}
                    aria-label={t("browserMoveDown")}
                    disabled={busy || index === steps.length - 1}
                    onClick={() =>
                      setStored((prev) => moveBrowserStep(normalizeBrowserSteps(prev) ?? [], step.id, 1))
                    }
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    style={smallBtnStyle}
                    aria-label={t("browserRemoveStep")}
                    disabled={busy}
                    onClick={() => setStored((prev) => removeBrowserStep(normalizeBrowserSteps(prev) ?? [], step.id))}
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section style={panelStyle} aria-label={t("browserShotTitle")}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: "var(--fs-xl)" }}>{t("browserShotTitle")}</h2>
          {shotStep ? (
            <span style={mutedStyle}>
              {t(opLabelKey(shotStep.op))}
              {browserStepArg(shotStep) ? ` · ${browserStepArg(shotStep)}` : ""}
            </span>
          ) : null}
          {liveUrl ? (
            <a
              href={liveUrl}
              target="_blank"
              rel="noreferrer"
              style={{ ...mutedStyle, marginLeft: "auto", whiteSpace: "nowrap" }}
            >
              {t("browserLiveView")}
            </a>
          ) : null}
        </div>
        {shot ? (
          // eslint-disable-next-line @next/next/no-img-element -- 沙箱截图是任意尺寸的 base64 数据 URL，不适合 next/image。
          <img src={`data:image/png;base64,${shot}`} alt={t("browserShotTitle")} style={shotStyle} />
        ) : (
          <div
            style={{
              ...mutedStyle,
              border: "3px dashed var(--color-border)",
              borderRadius: "var(--radius-sm)",
              padding: "var(--space-lg)",
              textAlign: "center",
            }}
          >
            {t("browserShotEmpty")}
          </div>
        )}
      </section>
    </div>
  );
}
