"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "../../components/ui";
import { useStickyState } from "../components/useStickyState";
import {
  appendEntries,
  clampTimeoutSec,
  CODE_STORAGE_KEY,
  CONVERSATION_KEY,
  DEFAULT_RUN_TIMEOUT_S,
  HOST_PORT,
  LANGUAGES,
  makeEntry,
  normalizeCode,
  normalizeRunPayload,
  randomId,
  remainingMs,
  rotateConversationId,
  sanitizeLanguage,
  formatElapsedSeconds,
  getOrCreateConversationId,
  languageDef,
  type ConsoleEntry,
  type LanguageId,
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
  minHeight: 220,
  resize: "vertical" as const,
  padding: "var(--space-xs)",
  fontSize: "var(--fs-sm)",
  lineHeight: 1.6,
  border: "3px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
};

const consoleStyle = {
  ...monoStyle,
  maxHeight: 320,
  overflowY: "auto" as const,
  padding: "var(--space-xs)",
  fontSize: "var(--fs-sm)",
  lineHeight: 1.6,
  border: "3px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  display: "grid",
  gap: "2px",
  alignContent: "start",
} as const;

const entryColor: Record<ConsoleEntry["kind"], string> = {
  system: "var(--color-text-muted)",
  stdout: "var(--color-text)",
  stderr: "var(--color-err-text)",
  result: "var(--color-accent)",
  error: "var(--color-err-text)",
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

export default function CodeSandboxClient() {
  const t = useTranslations("tools.sandbox");
  const [lang, setLang] = useState<LanguageId>("python");
  const [codeMap, setCodeMap] = useStickyState<Record<string, string>>({}, CODE_STORAGE_KEY);
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<SandboxSnapshot | null>(null);
  const [sandboxActive, setSandboxActive] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [conversationId, setConversationId] = useState("");
  const [lastElapsedMs, setLastElapsedMs] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const consoleRef = useRef<HTMLDivElement>(null);

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

  // 控制台自动滚底。
  useEffect(() => {
    const el = consoleRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

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
    pushEntries([
      makeEntry("system", t("runStarted", { language: LANGUAGE_LABELS[lang] }), Date.now(), randomId()),
    ]);
    try {
      const res = await post(
        { action: "run", language: lang, code, timeoutSec },
        conversationId,
      );
      const raw: unknown = await res.json().catch(() => null);
      const payload = normalizeRunPayload(raw);
      if (!payload) {
        pushEntries([makeEntry("error", t("invalidResponse"), Date.now(), randomId())]);
        return;
      }
      if (!res.ok || !payload.ok) {
        if (payload.error === "sandbox-unavailable") {
          setUnavailable(true);
          setSandboxActive(false);
        }
        const detail = payload.error === "sandbox-unavailable" ? t("statusUnavailable") : payload.outcome.error || payload.error;
        pushEntries([
          makeEntry(
            "error",
            detail ? `${t("runFailed", { code: res.status })}\n${detail}` : t("runFailed", { code: res.status }),
            Date.now(),
            randomId(),
          ),
        ]);
        return;
      }
      setUnavailable(false);
      setSandboxActive(true);
      mergeSnapshot(payload.sandbox);
      setLastElapsedMs(payload.outcome.elapsedMs);
      const incoming: ConsoleEntry[] = [];
      if (payload.outcome.stdout) {
        incoming.push(makeEntry("stdout", payload.outcome.stdout, Date.now(), randomId()));
      }
      if (payload.outcome.stderr) {
        incoming.push(makeEntry("stderr", payload.outcome.stderr, Date.now(), randomId()));
      }
      for (const result of payload.outcome.results) {
        incoming.push(makeEntry("result", result, Date.now(), randomId()));
      }
      if (payload.outcome.error) {
        incoming.push(makeEntry("error", payload.outcome.error, Date.now(), randomId()));
      }
      incoming.push(
        makeEntry(
          "system",
          `${t("runFinished", { seconds: formatElapsedSeconds(payload.outcome.elapsedMs) })} · ${t("exitCodeLabel", { code: payload.outcome.exitCode })}`,
          Date.now(),
          randomId(),
        ),
      );
      pushEntries(incoming);
    } catch {
      pushEntries([makeEntry("error", t("runNetworkError"), Date.now(), randomId())]);
    } finally {
      setBusy(false);
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
      setLastElapsedMs(null);
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
  const runtime = languageDef(lang).runtime;
  const runtimeKey =
    runtime === "kernel" ? "runtimeKernel" : runtime === "shell" ? "runtimeShell" : "runtimeToolchain";

  function updateCode(next: string) {
    setCodeMap((prev) => ({ ...prev, [lang]: normalizeCode(next) }));
  }

  function insertSample() {
    setCodeMap((prev) => ({ ...prev, [lang]: languageDef(lang).sample }));
  }

  function clearConsole() {
    setEntries([]);
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-lg)", gridColumn: "1 / -1" }}>
      {/* 沙箱信息面板 */}
      <section style={cardStyle} aria-label={t("infoTitle")}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: "var(--fs-xl)" }}>{t("infoTitle")}</h2>
          <span style={statusBadgeStyle(statusKey)}>
            {t(
              statusKey === "busy"
                ? "statusBusy"
                : statusKey === "unavailable"
                  ? "statusUnavailable"
                  : statusKey === "ready"
                    ? "statusReady"
                    : "statusIdle",
            )}
          </span>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: "var(--space-xs)",
          }}
        >
          <div>
            <div style={mutedStyle}>{t("statusLabel")}</div>
            <div style={{ fontWeight: 700 }}>
              {t(
                statusKey === "busy"
                  ? "statusBusy"
                  : statusKey === "unavailable"
                    ? "statusUnavailable"
                    : statusKey === "ready"
                      ? "statusReady"
                      : "statusIdle",
              )}
            </div>
          </div>
          <div>
            <div style={mutedStyle}>{t("instanceLabel")}</div>
            <div style={{ ...monoStyle, fontSize: "var(--fs-sm)", wordBreak: "break-all" }}>
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
          <div>
            <div style={mutedStyle}>{t("runtimeLabel")}</div>
            <div style={{ fontWeight: 700 }}>{t(runtimeKey)}</div>
          </div>
          <div>
            <div style={mutedStyle}>{t("externalUrlLabel")}</div>
            {info?.externalUrl ? (
              <a
                href={info.externalUrl}
                target="_blank"
                rel="noreferrer"
                style={{ ...monoStyle, fontSize: "var(--fs-sm)", wordBreak: "break-all" }}
              >
                {info.externalUrl}
              </a>
            ) : (
              <div style={mutedStyle}>{t("externalUrlHint", { port: HOST_PORT })}</div>
            )}
          </div>
          <div>
            <div style={mutedStyle}>{t("elapsedLabel")}</div>
            <div style={{ fontWeight: 700 }}>
              {lastElapsedMs === null ? "—" : t("elapsedValue", { seconds: formatElapsedSeconds(lastElapsedMs) })}
            </div>
          </div>
        </div>
      </section>

      {/* 编辑器与操作 */}
      <section style={cardStyle}>
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
          <Button onClick={clearConsole} disabled={busy}>
            {t("clear")}
          </Button>
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
        <p style={{ ...mutedStyle, margin: 0 }}>{t("hint")}</p>
      </section>

      {/* 控制台 */}
      <section style={cardStyle}>
        <h2 style={{ margin: 0, fontSize: "var(--fs-xl)" }}>{t("consoleTitle")}</h2>
        <div
          ref={consoleRef}
          style={consoleStyle}
          role="log"
          aria-live="polite"
          aria-label={t("consoleTitle")}
        >
          {entries.length === 0 ? (
            <div style={{ color: "var(--color-text-muted)" }}>{t("consoleEmpty")}</div>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.id}
                style={{
                  ...monoStyle,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  color: entryColor[entry.kind],
                  fontWeight: entry.kind === "error" ? 700 : 400,
                }}
              >
                {entry.text}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
