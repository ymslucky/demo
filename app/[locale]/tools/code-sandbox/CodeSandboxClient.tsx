"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { Show, SignInButton } from "@clerk/nextjs";
import { Button } from "../../components/ui";
import { useStickyState } from "../components/useStickyState";
import {
  appendEntries,
  appendRuns,
  clampTimeoutSec,
  CODE_STORAGE_KEY,
  CONVERSATION_KEY,
  DEFAULT_RUN_TIMEOUT_S,
  formatClock,
  formatElapsedSeconds,
  getOrCreateConversationId,
  LANGUAGES,
  languageDef,
  makeEntry,
  normalizeCode,
  normalizeRunPayload,
  randomId,
  remainingMs,
  rotateConversationId,
  type ConsoleEntry,
  type LanguageId,
  type RunRecord,
  type SandboxSnapshot,
} from "./utils";

// 语言名为专有名词，直接展示（与词表解耦）。
const LANGUAGE_LABELS: Record<LanguageId, string> = {
  python: "Python",
  javascript: "JavaScript",
  bash: "Bash",
  go: "Go",
  java: "Java",
};

// 与 todo-list / http-check 工具页一致的 Neo-Brutalism 卡片样式（内联变量，
// 不新增全局容器类，避免同步 e2e 脚本的义务）。
const cardStyle = {
  background: "var(--color-surface)",
  border: "3px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--shadow-sm)",
  padding: "var(--space-lg)",
  display: "grid",
  gap: "var(--space-sm)",
} as const;

const mutedStyle = {
  fontSize: "var(--fs-sm)",
  color: "var(--color-text-muted)",
} as const;

const monoStyle = {
  fontFamily: "var(--font-mono)",
} as const;

// 工作台骨架：顶栏自适应高度 + 主区吃掉剩余视口（铺满屏幕）。
const workbenchStyle = {
  display: "grid",
  gridTemplateRows: "auto minmax(420px, 1fr)",
  gap: "var(--space-md)",
  minHeight: "calc(100vh - 21rem)",
  gridColumn: "1 / -1",
} as const;

// 主区两列：宽屏编辑器 | 终端+历史，窄屏自动单列（无需 media query）。
const mainAreaStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 480px), 1fr))",
  gridAutoRows: "minmax(0, 1fr)",
  gap: "var(--space-md)",
  minHeight: 0,
} as const;

const chipStyle = (active: boolean) =>
  ({
    border: "3px solid var(--color-border)",
    borderRadius: "var(--radius-sm)",
    padding: "0.35rem 0.75rem",
    fontSize: "var(--fs-sm)",
    fontWeight: 700,
    cursor: "pointer",
    background: active ? "var(--color-primary)" : "var(--color-surface)",
    color: active ? "var(--color-on-primary)" : "var(--color-text)",
    boxShadow: "var(--shadow-sm)",
  }) as const;

const editorStyle = {
  ...monoStyle,
  width: "100%",
  flex: 1,
  minHeight: 200,
  resize: "vertical" as const,
  padding: "var(--space-sm)",
  fontSize: "var(--fs-sm)",
  lineHeight: 1.6,
  border: "3px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
};

// 终端反色：底=主字色、前景=页面底色，亮暗主题自动保持终端观感。
const terminalStyle = {
  ...monoStyle,
  flex: 1,
  minHeight: 200,
  overflowY: "auto" as const,
  padding: "var(--space-sm)",
  fontSize: "var(--fs-sm)",
  lineHeight: 1.6,
  border: "3px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  background: "var(--color-text)",
  color: "var(--color-bg)",
  display: "grid",
  gap: "2px",
  alignContent: "start",
} as const;

// 终端行配色：错误/标准错误用主色强调，结果用强调色，系统消息弱化。
const terminalEntryStyle: Record<ConsoleEntry["kind"], CSSProperties> = {
  system: { opacity: 0.65 },
  stdout: {},
  stderr: { color: "var(--color-primary-light)", fontWeight: 700 },
  result: { color: "var(--color-accent)", fontWeight: 700 },
  error: { color: "var(--color-primary-light)", fontWeight: 700 },
};

function statusBadgeStyle(kind: "idle" | "ready" | "busy" | "unavailable") {
  const palette =
    kind === "ready"
      ? { bg: "var(--color-info-bg)", fg: "var(--color-info-text)" }
      : kind === "unavailable"
        ? { bg: "var(--color-err-bg)", fg: "var(--color-err-text)" }
        : kind === "busy"
          ? { bg: "var(--color-tint-strong)", fg: "var(--color-text)" }
          : { bg: "var(--color-tag-bg)", fg: "var(--color-tag-text)" };
  return {
    display: "inline-block",
    border: "2px solid var(--color-border)",
    borderRadius: "var(--radius-sm)",
    padding: "0.15rem 0.6rem",
    fontSize: "var(--fs-xs)",
    fontWeight: 800,
    background: palette.bg,
    color: palette.fg,
  } as const;
}

const runBadgeStyle = (ok: boolean) =>
  ({
    flexShrink: 0,
    border: "2px solid var(--color-border)",
    borderRadius: "var(--radius-sm)",
    padding: "0.05rem 0.4rem",
    fontSize: "var(--fs-xs)",
    fontWeight: 800,
    background: ok ? "var(--color-info-bg)" : "var(--color-err-bg)",
    color: ok ? "var(--color-info-text)" : "var(--color-err-text)",
  }) as const;

const historyItemStyle = (active: boolean) =>
  ({
    ...monoStyle,
    display: "flex",
    alignItems: "center",
    gap: "var(--space-xs)",
    width: "100%",
    padding: "0.4rem 0.6rem",
    border: "2px solid var(--color-border)",
    borderRadius: "var(--radius-sm)",
    fontSize: "var(--fs-sm)",
    textAlign: "left" as const,
    cursor: "pointer",
    background: active ? "var(--color-tint-strong)" : "var(--color-surface)",
    color: "var(--color-text)",
  }) as const;

export default function CodeSandboxClient() {
  const t = useTranslations("tools.sandbox");
  const [lang, setLang] = useState<LanguageId>("python");
  const [codeMap, setCodeMap] = useStickyState<Record<string, string>>({}, CODE_STORAGE_KEY);
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [viewingRun, setViewingRun] = useState<RunRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<SandboxSnapshot | null>(null);
  const [sandboxActive, setSandboxActive] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [conversationId, setConversationId] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const terminalRef = useRef<HTMLDivElement>(null);

  // 会话 ID 挂载时生成/复用（localStorage）；换 ID = 新沙箱实例。
  // （SSR 无法读 localStorage，只能挂载后回填 —— 与 useStickyState 同一模式。）
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConversationId(getOrCreateConversationId(window.localStorage, CONVERSATION_KEY));
  }, []);

  // 到期倒计时：15s 心跳足够（分钟级展示）。
  const expiresAt = info?.expiresAt;
  useEffect(() => {
    if (!expiresAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  // 终端自动滚底（实时流更新或历史回放切换时）。
  useEffect(() => {
    const el = terminalRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, viewingRun]);

  const code = normalizeCode(codeMap[lang] ?? languageDef(lang).sample);
  const timeoutSec = clampTimeoutSec(DEFAULT_RUN_TIMEOUT_S);

  const pushEntries = useCallback((incoming: ConsoleEntry[]) => {
    setEntries((prev) => appendEntries(prev, incoming));
  }, []);

  const post = useCallback(
    (body: Record<string, unknown>, convId: string) =>
      fetch("/code-run", {
        method: "POST",
        headers: { "content-type": "application/json", "makers-conversation-id": convId },
        body: JSON.stringify(body),
      }),
    [],
  );

  const mergeSnapshot = useCallback((incoming: SandboxSnapshot) => {
    setInfo((prev) => ({
      instanceId: incoming.instanceId ?? prev?.instanceId,
      expiresAt: incoming.expiresAt ?? prev?.expiresAt,
      externalUrl: incoming.externalUrl ?? prev?.externalUrl,
    }));
  }, []);

  async function run() {
    if (busy || !conversationId || !code.trim()) return;
    setBusy(true);
    // 终端只保留当前运行：先清掉上一次的实时输出（历史回放不受影响）。
    setEntries([]);
    const startedAt = Date.now();
    const output: ConsoleEntry[] = [];
    const emit = (kind: ConsoleEntry["kind"], text: string) => {
      const entry = makeEntry(kind, text, Date.now(), randomId());
      output.push(entry);
      pushEntries([entry]);
    };
    let ok = false;
    let elapsedMs: number | null = null;
    let exitCode: number | null = null;
    try {
      emit("system", t("runStarted", { language: LANGUAGE_LABELS[lang] }));
      const res = await post(
        { action: "run", language: lang, code, timeoutSec },
        conversationId,
      );
      const raw: unknown = await res.json().catch(() => null);
      const payload = normalizeRunPayload(raw);
      if (!payload) {
        emit("error", t("invalidResponse"));
        return;
      }
      if (!res.ok || !payload.ok) {
        if (payload.error === "sandbox-unavailable") {
          setUnavailable(true);
          setSandboxActive(false);
        }
        // 服务端错误码 → 可读文案：401 未登录 / 429 触发限速优先映射。
        const detail =
          payload.error === "sandbox-unavailable"
            ? t("statusUnavailable")
            : payload.error === "unauthorized"
              ? t("runUnauthorized")
              : payload.error === "rate-limited"
                ? t("runLimited")
                : payload.outcome.error || payload.error;
        emit(
          "error",
          detail ? `${t("runFailed", { code: res.status })}\n${detail}` : t("runFailed", { code: res.status }),
        );
        return;
      }
      setUnavailable(false);
      setSandboxActive(true);
      mergeSnapshot(payload.sandbox);
      ok = true;
      elapsedMs = payload.outcome.elapsedMs;
      exitCode = payload.outcome.exitCode;
      if (payload.outcome.stdout) {
        emit("stdout", payload.outcome.stdout);
      }
      if (payload.outcome.stderr) {
        emit("stderr", payload.outcome.stderr);
      }
      for (const result of payload.outcome.results) {
        emit("result", result);
      }
      if (payload.outcome.error) {
        emit("error", payload.outcome.error);
      }
      emit(
        "system",
        `${t("runFinished", { seconds: formatElapsedSeconds(payload.outcome.elapsedMs) })} · ${t("exitCodeLabel", { code: payload.outcome.exitCode })}`,
      );
    } catch {
      emit("error", t("runNetworkError"));
    } finally {
      setBusy(false);
      // 每次运行（含失败请求）都记入历史，并切回实时视图。
      setRuns((prev) =>
        appendRuns(prev, {
          id: randomId(),
          language: lang,
          at: startedAt,
          ok,
          elapsedMs,
          exitCode,
          code,
          output,
        }),
      );
      setViewingRun(null);
    }
  }

  async function reset() {
    if (busy || !conversationId) return;
    setBusy(true);
    try {
      const res = await post({ action: "kill" }, conversationId);
      if (res.ok) {
        pushEntries([makeEntry("system", t("resetDone"), Date.now(), randomId())]);
      } else {
        pushEntries([makeEntry("error", t("resetFailed", { code: res.status }), Date.now(), randomId())]);
      }
    } catch {
      pushEntries([makeEntry("error", t("resetFailed", { code: 0 }), Date.now(), randomId())]);
    } finally {
      // 无论销毁是否成功，都换新会话 ID 指向全新实例。
      setConversationId(rotateConversationId(window.localStorage, CONVERSATION_KEY));
      setInfo(null);
      setSandboxActive(false);
      setUnavailable(false);
      setBusy(false);
    }
  }

  async function extend() {
    if (busy || !conversationId) return;
    setBusy(true);
    try {
      const res = await post({ action: "extend", seconds: 600 }, conversationId);
      const raw: unknown = await res.json().catch(() => null);
      const payload = normalizeRunPayload(raw);
      if (res.ok && payload?.ok) {
        mergeSnapshot(payload.sandbox);
        setSandboxActive(true);
        setUnavailable(false);
        pushEntries([makeEntry("system", t("extendDone"), Date.now(), randomId())]);
      } else {
        pushEntries([makeEntry("error", t("extendFailed", { code: res.status }), Date.now(), randomId())]);
      }
    } catch {
      pushEntries([makeEntry("error", t("extendFailed", { code: 0 }), Date.now(), randomId())]);
    } finally {
      setBusy(false);
    }
  }

  async function refreshInfo() {
    if (busy || !conversationId) return;
    setBusy(true);
    try {
      const res = await post({ action: "info" }, conversationId);
      const raw: unknown = await res.json().catch(() => null);
      const payload = normalizeRunPayload(raw);
      if (res.ok && payload?.ok) {
        mergeSnapshot(payload.sandbox);
        setSandboxActive(true);
        setUnavailable(false);
      } else {
        pushEntries([makeEntry("system", t("infoUnavailable"), Date.now(), randomId())]);
      }
    } catch {
      pushEntries([makeEntry("system", t("infoUnavailable"), Date.now(), randomId())]);
    } finally {
      setBusy(false);
    }
  }

  const minutesLeft = info?.expiresAt ? remainingMs(info.expiresAt, now) : null;
  const statusKey: "idle" | "ready" | "busy" | "unavailable" = busy
    ? "busy"
    : unavailable
      ? "unavailable"
      : sandboxActive
        ? "ready"
        : "idle";
  const statusTextKey =
    statusKey === "busy"
      ? "statusBusy"
      : statusKey === "unavailable"
        ? "statusUnavailable"
        : statusKey === "ready"
          ? "statusReady"
          : "statusIdle";
  const runtime = languageDef(lang).runtime;
  const runtimeKey =
    runtime === "kernel" ? "runtimeKernel" : runtime === "shell" ? "runtimeShell" : "runtimeToolchain";

  function updateCode(next: string) {
    setCodeMap((prev) => ({ ...prev, [lang]: normalizeCode(next) }));
  }

  function insertSample() {
    setCodeMap((prev) => ({ ...prev, [lang]: languageDef(lang).sample }));
  }

  function clearTerminal() {
    setEntries([]);
  }

  // 历史回放 → 编辑器：恢复该次运行的语言与代码（不离开回放视图）。
  function restoreRunCode() {
    if (!viewingRun) return;
    setLang(viewingRun.language);
    setCodeMap((prev) => ({ ...prev, [viewingRun.language]: normalizeCode(viewingRun.code) }));
  }

  // 终端展示内容：实时流，或选中历史记录的输出快照（回放）。
  const visibleEntries = viewingRun ? viewingRun.output : entries;

  // 仅登录用户可用：客户端用 Clerk <Show> 门控渲染（页面保持静态预渲染），
  // 服务端 agents/code-run 对所有动作做真实 JWT 验签（401）——UI 门控只是
  // 展示层，不构成安全边界。
  return (
    <>
      <Show when="signed-in">
        <div style={workbenchStyle}>
      {/* 顶栏：沙箱状态 + 实例信息 + 实例操作 */}
      <section
        style={{ ...cardStyle, display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-sm)" }}
        aria-label={t("infoTitle")}
      >
        <h2 style={{ margin: 0, fontSize: "var(--fs-xl)" }}>{t("infoTitle")}</h2>
        <span style={statusBadgeStyle(statusKey)}>{t(statusTextKey)}</span>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-md)" }}>
          <div>
            <div style={mutedStyle}>{t("runtimeLabel")}</div>
            <div style={{ fontWeight: 700 }}>{t(runtimeKey)}</div>
          </div>
          <div>
            <div style={mutedStyle}>{t("instanceLabel")}</div>
            <div style={{ ...monoStyle, fontSize: "var(--fs-sm)", wordBreak: "break-all", maxWidth: 260 }}>
              {info?.instanceId ?? "—"}
            </div>
          </div>
          <div>
            <div style={mutedStyle}>{t("expiryLabel")}</div>
            <div style={{ fontWeight: 700 }}>
              {minutesLeft === null
                ? "—"
                : minutesLeft <= 0
                  ? t("expired")
                  : t("minutesLeft", { count: Math.ceil(minutesLeft / 60_000) })}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-xs)", marginLeft: "auto" }}>
          <Button onClick={refreshInfo} disabled={busy || !conversationId}>
            {t("refreshInfo")}
          </Button>
          <Button onClick={extend} disabled={busy || !conversationId}>
            {t("extend")}
          </Button>
          <Button onClick={reset} disabled={busy || !conversationId}>
            {t("reset")}
          </Button>
        </div>
      </section>

      {/* 工作台主区：左编辑器，右终端 + 运行历史 */}
      <div style={mainAreaStyle}>
        <section
          style={{ ...cardStyle, display: "flex", flexDirection: "column", minHeight: 0 }}
          aria-label={t("codeLabel")}
        >
          <h2 style={{ margin: 0, fontSize: "var(--fs-xl)" }}>{t("languageLabel")}</h2>
          <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }} role="group" aria-label={t("languageLabel")}>
            {LANGUAGES.map((def) => (
              <button
                key={def.id}
                type="button"
                style={chipStyle(def.id === lang)}
                aria-pressed={def.id === lang}
                onClick={() => setLang(def.id)}
              >
                {LANGUAGE_LABELS[def.id]}
              </button>
            ))}
          </div>
          <textarea
            style={editorStyle}
            value={code}
            onChange={(event) => updateCode(event.target.value)}
            spellCheck={false}
            aria-label={t("codeLabel")}
          />
          <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>
            <Button variant="primary" onClick={run} disabled={busy || !conversationId || !code.trim()}>
              {busy ? t("running") : t("run")}
            </Button>
            <Button onClick={insertSample} disabled={busy}>
              {t("insertSample")}
            </Button>
          </div>
          <p style={{ ...mutedStyle, margin: 0 }}>{t("hint")}</p>
        </section>

        <div style={{ display: "grid", gridTemplateRows: "minmax(240px, 1fr) auto", gap: "var(--space-md)", minHeight: 0 }}>
          {/* 终端：独立展示运行结果（实时流或历史回放） */}
          <section
            style={{ ...cardStyle, display: "flex", flexDirection: "column", minHeight: 0 }}
            aria-label={t("consoleTitle")}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)", flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, fontSize: "var(--fs-xl)" }}>{t("consoleTitle")}</h2>
              {viewingRun ? (
                <>
                  <Button onClick={restoreRunCode}>{t("restoreCode")}</Button>
                  <Button onClick={() => setViewingRun(null)}>{t("backToLive")}</Button>
                </>
              ) : (
                <Button onClick={clearTerminal} disabled={busy}>
                  {t("clear")}
                </Button>
              )}
            </div>
            <div
              ref={terminalRef}
              style={terminalStyle}
              role="log"
              aria-live="polite"
              aria-label={t("consoleTitle")}
            >
              {visibleEntries.length === 0 ? (
                <div style={{ opacity: 0.65 }}>{t("consoleEmpty")}</div>
              ) : (
                visibleEntries.map((entry) => (
                  <div
                    key={entry.id}
                    style={{
                      ...monoStyle,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      ...terminalEntryStyle[entry.kind],
                    }}
                  >
                    {entry.text}
                  </div>
                ))
              )}
            </div>
          </section>

          {/* 运行历史：每次运行一条记录，点击回放到终端 */}
          <section style={cardStyle} aria-label={t("historyTitle")}>
            <h2 style={{ margin: 0, fontSize: "var(--fs-xl)" }}>{t("historyTitle")}</h2>
            {runs.length === 0 ? (
              <div style={mutedStyle}>{t("historyEmpty")}</div>
            ) : (
              <div style={{ display: "grid", gap: "var(--space-xs)", maxHeight: 240, overflowY: "auto", alignContent: "start" }}>
                {runs.map((record) => (
                  <button
                    key={record.id}
                    type="button"
                    style={historyItemStyle(viewingRun?.id === record.id)}
                    onClick={() => setViewingRun(record)}
                  >
                    <span style={runBadgeStyle(record.ok)} aria-hidden="true">
                      {record.ok ? "✓" : "✗"}
                    </span>
                    <span style={{ fontWeight: 700 }}>{LANGUAGE_LABELS[record.language]}</span>
                    <span>{formatClock(record.at)}</span>
                    <span style={{ ...mutedStyle, marginLeft: "auto" }}>
                      {record.elapsedMs !== null
                        ? t("elapsedValue", { seconds: formatElapsedSeconds(record.elapsedMs) })
                        : record.exitCode !== null
                          ? t("exitCodeLabel", { code: record.exitCode })
                          : null}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
        </div>
      </Show>
      <Show when="signed-out">
        <section style={cardStyle} aria-label={t("gateTitle")}>
          <h2 style={{ margin: 0, fontSize: "var(--fs-xl)" }}>{t("gateTitle")}</h2>
          <p style={{ ...mutedStyle, margin: 0 }}>{t("gateHint")}</p>
          <div>
            <SignInButton mode="modal">
              <Button variant="primary">{t("gateSignIn")}</Button>
            </SignInButton>
          </div>
        </section>
      </Show>
    </>
  );
}
