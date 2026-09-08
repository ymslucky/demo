"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { SignInButton, useUser } from "@clerk/nextjs";
import {
  MAX_ITEMS,
  MAX_NOTE_LEN,
  normalizeItems,
  statsSummary,
  trend7Days,
  type TodoItem,
} from "./utils";

// 与 http-check 工具页保持一致的 Neo-Brutalism 卡片样式（内联变量）。
const cardStyle = {
  gridColumn: "1 / -1" as const,
  background: "var(--color-surface)",
  border: "3px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--shadow-sm)",
  padding: "var(--space-lg)",
};

const mutedStyle = {
  fontSize: "var(--fs-sm)",
  color: "var(--color-text-muted)",
} as const;

const inputStyle = {
  padding: "0.5rem 0.75rem",
  border: "3px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
  font: "inherit",
} as const;

const rowStyle = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-sm)",
  padding: "var(--space-xs) var(--space-sm)",
  border: "3px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  background: "var(--color-surface)",
} as const;

const doneStyle = {
  textDecoration: "line-through",
  color: "var(--color-text-muted)",
} as const;

const iconBtnStyle = {
  flex: "none",
  border: "3px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
  fontWeight: 700,
  lineHeight: 1,
  padding: "0.25rem 0.6rem",
  cursor: "pointer",
} as const;

const tileStyle = {
  border: "3px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  boxShadow: "var(--shadow-sm)",
  background: "var(--color-surface)",
  padding: "var(--space-xs) var(--space-sm)",
  display: "grid",
  justifyItems: "center",
  gap: "2px",
} as const;

const tileNumStyle = {
  fontSize: "var(--fs-2xl)",
  fontWeight: 800,
  lineHeight: 1.1,
} as const;

const legendSwatchStyle = {
  display: "inline-block",
  width: 12,
  height: 12,
  border: "2px solid var(--color-border)",
  flex: "none",
} as const;

/** 调用 /api/todo：body 缺省时发无载荷请求（GET），否则发 JSON。 */
async function fetchItems(method: "GET" | "POST" | "PATCH" | "DELETE", body?: unknown) {
  const res = await fetch("/api/todo", {
    method,
    cache: "no-store",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) return { unauthorized: true as const, data: null };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { unauthorized: false as const, data: normalizeItems(await res.json()) };
}

/** 条目补丁：仅传入的字段生效。 */
type TodoPatch = { title?: string; note?: string; done?: boolean };

/**
 * 存储后端统一接口。登录用户走 /api/todo（云端 KV、按账号隔离），
 * 未登录访客走 localStorage（仅当前浏览器）。每个方法返回写入后的
 * 最新清单；"unauthorized" 表示云端会话失效（翻入 expired 状态）；
 * null 表示载荷损坏或写入失败（调用方重读纠偏）。
 */
interface TodoStorage {
  load(): Promise<TodoItem[] | "unauthorized" | null>;
  add(title: string, note: string): Promise<TodoItem[] | "unauthorized" | null>;
  update(id: string, patch: TodoPatch): Promise<TodoItem[] | "unauthorized" | null>;
  remove(id: string): Promise<TodoItem[] | "unauthorized" | null>;
}

function cloudStorage(): TodoStorage {
  // KV 写请求串行队列：前一个写落地后才发下一个，避免高延迟下
  // 并发 PATCH 在服务端互相覆盖（后写胜出丢改）。
  let chain: Promise<unknown> = Promise.resolve();
  const enqueue = <T,>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(task, task);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
  return {
    async load() {
      const { unauthorized, data } = await fetchItems("GET");
      return unauthorized ? "unauthorized" : data;
    },
    async add(title, note) {
      const { unauthorized, data } = await enqueue(() =>
        fetchItems("POST", { title, note }),
      );
      return unauthorized ? "unauthorized" : data;
    },
    async update(id, patch) {
      const { unauthorized, data } = await enqueue(() =>
        fetchItems("PATCH", { id, ...patch }),
      );
      return unauthorized ? "unauthorized" : data;
    },
    async remove(id) {
      const { unauthorized, data } = await enqueue(() => fetchItems("DELETE", { id }));
      return unauthorized ? "unauthorized" : data;
    },
  };
}

const LOCAL_KEY = "lucky-todo-local-v1";

function readLocalItems(): TodoItem[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    // 兼容两种历史格式：{ items } 包装与裸数组（当前写入格式）。
    const wrapper = parsed as { items?: unknown } | null;
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray(wrapper?.items)
        ? wrapper.items
        : null;
    return list ? (normalizeItems({ items: list }) ?? []) : [];
  } catch {
    return [];
  }
}

/** 写入并返回封顶后的最新清单；配额溢出等异常返回 null。 */
function writeLocalItems(items: TodoItem[]): TodoItem[] | null {
  const capped = items.slice(0, MAX_ITEMS);
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(capped));
    return capped;
  } catch {
    return null;
  }
}

function makeLocalItem(title: string, note: string): TodoItem {
  // 与边缘函数 makeItemId 同构：base36 时间戳 + 短随机段。
  const now = Date.now();
  return {
    id: `${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    title,
    note,
    done: false,
    createdAt: now,
    completedAt: 0,
  };
}

function localBackend(): TodoStorage {
  return {
    async load() {
      return readLocalItems();
    },
    async add(title, note) {
      return writeLocalItems([makeLocalItem(title, note), ...readLocalItems()]);
    },
    async update(id, patch) {
      const items = readLocalItems();
      if (!items.some((item) => item.id === id)) return null;
      const next = items.map((item) =>
        item.id === id
          ? {
              ...item,
              ...(patch.title === undefined ? null : { title: patch.title }),
              ...(patch.note === undefined ? null : { note: patch.note }),
              // done 切换联动完成时间，与边缘函数语义一致。
              ...(patch.done === undefined
                ? null
                : { done: patch.done, completedAt: patch.done ? Date.now() : 0 }),
            }
          : item,
      );
      return writeLocalItems(next);
    },
    async remove(id) {
      return writeLocalItems(readLocalItems().filter((item) => item.id !== id));
    },
  };
}

/** 同步指示器状态机：静默 → 进行中 → 已同步 / 失败（已触发重读纠偏）。 */
type SyncState = "idle" | "syncing" | "saved" | "error";

/** 编辑弹窗载荷；null = 弹窗关闭。 */
interface EditDraft {
  id: string;
  title: string;
  note: string;
}

/**
 * 清单面板：后端跟随 Clerk 登录态（云端 KV / 本地浏览器）。初始加载
 * 一次；增删改均先本地乐观更新（UI 即时反馈），写入在后台串行执行，
 * 由同步指示器反馈结果；回包异常时重读存储纠偏。
 */
function TodoPanel() {
  const t = useTranslations("tools.todo");
  // Clerk 会话解析完成前不选择后端，避免登录用户闪现本地模式。
  const { isLoaded, isSignedIn } = useUser();

  const [items, setItems] = useState<TodoItem[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "expired">("loading");
  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState<"list" | "stats">("list");
  const [editing, setEditing] = useState<EditDraft | null>(null);
  const [sync, setSync] = useState<SyncState>("idle");
  // 最近一次成功写入的本地时间戳（null = 本次会话尚未写入）。
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // 趋势分桶基准时刻：挂载时取一次即可（7 天粒度无需实时走秒）。
  const [now] = useState(() => Date.now());
  // 卸载后丢弃过期响应，避免对已卸载组件 setState。
  const aliveRef = useRef(true);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const listTabRef = useRef<HTMLButtonElement | null>(null);
  const statsTabRef = useRef<HTMLButtonElement | null>(null);

  // 登录 → 云端 KV（按账号隔离）；未登录 → localStorage（仅本浏览器）。
  const storage = useMemo(() => (isSignedIn ? cloudStorage() : localBackend()), [isSignedIn]);

  const apply = useCallback((data: TodoItem[] | null) => {
    if (data) {
      setItems(data);
      setStatus("ready");
    } else {
      setStatus("error");
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const result = await storage.load();
      if (!aliveRef.current) return;
      if (result === "unauthorized") {
        setStatus("expired");
        return;
      }
      apply(result);
    } catch {
      if (aliveRef.current) setStatus("error");
    }
  }, [storage, apply]);

  useEffect(() => {
    if (!isLoaded) return undefined;
    aliveRef.current = true;
    // 首次拉取异步启动（react-hooks 禁止在 effect 体内同步进入 setState
    // 路径）。
    const kickoff = setTimeout(load, 0);
    return () => {
      aliveRef.current = false;
      clearTimeout(kickoff);
    };
  }, [load, isLoaded]);

  /**
   * 后台写入统一通道：乐观更新完成后调用。成功以服务端回包覆盖清单，
   * 失败（null/异常）时重读存储纠偏并翻入 error 态。
   */
  const runWrite = useCallback(
    async (task: () => Promise<TodoItem[] | "unauthorized" | null>) => {
      setSync("syncing");
      try {
        const result = await task();
        if (!aliveRef.current) return;
        if (result === "unauthorized") {
          setStatus("expired");
          return;
        }
        if (result) {
          setItems(result);
          setSavedAt(Date.now());
          setSync("saved");
        } else {
          setSync("error");
          load();
        }
      } catch {
        if (!aliveRef.current) return;
        setSync("error");
        load();
      }
    },
    [load],
  );

  const add = useCallback(() => {
    const title = draft.trim();
    if (!title) return;
    // 乐观插入临时条目（本地同构 id），存储回包到达后整体覆盖。
    const optimistic = makeLocalItem(title, "");
    setDraft("");
    setStatus("ready");
    setItems((current) => (current ? [optimistic, ...current] : [optimistic]));
    runWrite(() => storage.add(title, ""));
  }, [draft, storage, runWrite]);

  const toggle = useCallback(
    (item: TodoItem) => {
      const nextDone = !item.done;
      // 乐观切换 done 并联动完成时间（与边缘函数语义一致）。
      setItems((current) =>
        current
          ? current.map((entry) =>
              entry.id === item.id
                ? { ...entry, done: nextDone, completedAt: nextDone ? Date.now() : 0 }
                : entry,
            )
          : current,
      );
      runWrite(() => storage.update(item.id, { done: nextDone }));
    },
    [storage, runWrite],
  );

  const remove = useCallback(
    (id: string) => {
      // 乐观移除；若正编辑该条目则一并关闭弹窗。
      setItems((current) => (current ? current.filter((entry) => entry.id !== id) : current));
      setEditing((current) => (current?.id === id ? null : current));
      runWrite(() => storage.remove(id));
    },
    [storage, runWrite],
  );

  const startEdit = useCallback((item: TodoItem) => {
    setEditing({ id: item.id, title: item.title, note: item.note });
  }, []);

  const cancelEdit = useCallback(() => setEditing(null), []);

  const saveEdit = useCallback(() => {
    if (!editing) return;
    const title = editing.title.trim();
    if (!title) return;
    const { id, note } = editing;
    setEditing(null);
    // 乐观写回标题与详情，存储回包到达后整体覆盖。
    setItems((current) =>
      current
        ? current.map((entry) => (entry.id === id ? { ...entry, title, note } : entry))
        : current,
    );
    runWrite(() => storage.update(id, { title, note }));
  }, [editing, storage, runWrite]);

  // 弹窗开启时：Esc 关闭 + 锁定页面滚动；标题输入框自动聚焦。
  const editingOpen = editing !== null;
  useEffect(() => {
    if (!editingOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEditing(null);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    titleInputRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [editingOpen]);

  // 标签页方向键循环切换（roving focus）。
  const onTabKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (
        event.key !== "ArrowRight" &&
        event.key !== "ArrowLeft" &&
        event.key !== "ArrowDown" &&
        event.key !== "ArrowUp"
      ) {
        return;
      }
      event.preventDefault();
      const next = tab === "list" ? "stats" : "list";
      setTab(next);
      (next === "list" ? listTabRef : statsTabRef).current?.focus();
    },
    [tab],
  );

  if (status === "expired") {
    return (
      <section style={cardStyle}>
        <p>{t("sessionExpired")}</p>
        <SignInButton mode="modal">
          <button type="button" className="btn btn--primary btn--sm">
            {t("gateSignIn")}
          </button>
        </SignInButton>
      </section>
    );
  }

  if (status === "loading") {
    return (
      <section style={cardStyle}>
        <p style={mutedStyle}>{t("loading")}</p>
      </section>
    );
  }

  if (status === "error" || items === null) {
    return (
      <section style={cardStyle}>
        <p>{t("loadError")}</p>
        <button type="button" onClick={load} className="btn btn--primary btn--sm">
          {t("retry")}
        </button>
      </section>
    );
  }

  const stats = statsSummary(items);
  const rate = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;
  const trend = trend7Days(items, now);
  const maxCount = Math.max(1, ...trend.map((bucket) => Math.max(bucket.added, bucket.completed)));

  // 环形图几何常量：周长按半径推得，弧长按完成率截取。
  const donutRadius = 48;
  const donutCircumference = 2 * Math.PI * donutRadius;
  const dayLabel = (index: number) => {
    const date = new Date(now);
    date.setDate(date.getDate() - (6 - index));
    return date.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
  };

  return (
    <section style={cardStyle}>
      <div className="todo-tabs" role="tablist">
        <button
          ref={listTabRef}
          type="button"
          role="tab"
          id="todo-tab-list"
          aria-selected={tab === "list"}
          aria-controls="todo-panel-list"
          className="todo-tab"
          onClick={() => setTab("list")}
          onKeyDown={onTabKeyDown}
        >
          {t("tabList")}
        </button>
        <button
          ref={statsTabRef}
          type="button"
          role="tab"
          id="todo-tab-stats"
          aria-selected={tab === "stats"}
          aria-controls="todo-panel-stats"
          className="todo-tab"
          onClick={() => setTab("stats")}
          onKeyDown={onTabKeyDown}
        >
          {t("tabStats")}
        </button>
      </div>

      {tab === "list" ? (
        <div role="tabpanel" id="todo-panel-list" aria-labelledby="todo-tab-list">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              add();
            }}
            style={{ display: "flex", gap: "var(--space-sm)", marginBottom: "var(--space-md)" }}
          >
            <input
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t("inputPlaceholder")}
              aria-label={t("inputPlaceholder")}
              maxLength={200}
              style={{ ...inputStyle, flex: 1, minWidth: 0 }}
            />
            <button
              type="submit"
              disabled={draft.trim().length === 0}
              className="btn btn--primary btn--sm"
            >
              {t("add")}
            </button>
          </form>
          {items.length === 0 ? <p style={mutedStyle}>{t("empty")}</p> : null}
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gap: "var(--space-sm)",
            }}
          >
            {items.map((item) => (
              <li key={item.id} style={rowStyle}>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-sm)",
                    flex: 1,
                    minWidth: 0,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={() => toggle(item)}
                    style={{ accentColor: "var(--color-primary)", flex: "none" }}
                  />
                  <span style={item.done ? doneStyle : undefined}>
                    {item.title}
                    {item.note ? (
                      <span
                        aria-hidden="true"
                        style={{ color: "var(--color-primary)", marginLeft: "4px" }}
                      >
                        ✎
                      </span>
                    ) : null}
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => startEdit(item)}
                  aria-label={t("editItem", { title: item.title })}
                  style={iconBtnStyle}
                >
                  ✎
                </button>
                <button
                  type="button"
                  onClick={() => remove(item.id)}
                  aria-label={t("deleteItem", { title: item.title })}
                  style={iconBtnStyle}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>

          {/* 状态监控区：数据来源、最近写入、后台同步指示。 */}
          <div style={{ marginTop: "var(--space-md)", display: "grid", gap: "var(--space-xs)" }}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "var(--space-xs) var(--space-md)",
              }}
            >
              <span style={mutedStyle}>
                {t("storageSource", { source: isSignedIn ? t("storageCloud") : t("storageLocal") })}
              </span>
              <span style={mutedStyle}>
                {savedAt
                  ? t("lastSaved", { time: new Date(savedAt).toLocaleTimeString() })
                  : t("neverSaved")}
              </span>
              <span style={mutedStyle}>{t("statsPending", { count: stats.pending })}</span>
              {sync !== "idle" ? (
                <span
                  style={{
                    ...mutedStyle,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      border: "2px solid var(--color-border)",
                      background:
                        sync === "syncing"
                          ? "var(--color-primary)"
                          : sync === "saved"
                            ? "var(--color-accent)"
                            : "var(--color-err-text)",
                    }}
                  />
                  {sync === "syncing"
                    ? t("syncSaving")
                    : sync === "saved"
                      ? isSignedIn
                        ? t("syncSaved")
                        : t("localOnly")
                      : t("syncError")}
                </span>
              ) : null}
            </div>
            {isSignedIn ? (
              <p style={{ ...mutedStyle, margin: 0 }}>{t("kvHint")}</p>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: "var(--space-sm)",
                }}
              >
                <p style={{ ...mutedStyle, margin: 0, flex: 1, minWidth: 0 }}>{t("localHint")}</p>
                <SignInButton mode="modal">
                  <button type="button" className="btn btn--primary btn--sm">
                    {t("gateSignIn")}
                  </button>
                </SignInButton>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div role="tabpanel" id="todo-panel-stats" aria-labelledby="todo-tab-stats">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: "var(--space-sm)",
              marginBottom: "var(--space-md)",
            }}
          >
            <div style={tileStyle}>
              <span style={tileNumStyle}>{stats.total}</span>
              <span style={mutedStyle}>{t("statTotal")}</span>
            </div>
            <div style={tileStyle}>
              <span style={tileNumStyle}>{stats.done}</span>
              <span style={mutedStyle}>{t("statDoneLabel")}</span>
            </div>
            <div style={tileStyle}>
              <span style={tileNumStyle}>{stats.pending}</span>
              <span style={mutedStyle}>{t("statPendingLabel")}</span>
            </div>
          </div>

          {stats.total === 0 ? (
            <p style={mutedStyle}>{t("trendEmpty")}</p>
          ) : (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "var(--space-md)",
              }}
            >
              <div style={{ flex: "none", display: "grid", justifyItems: "center" }}>
                <svg
                  viewBox="0 0 120 120"
                  role="img"
                  aria-label={t("donutLabel", { rate })}
                  style={{ width: 140, height: 140 }}
                >
                  <circle
                    cx="60"
                    cy="60"
                    r={donutRadius}
                    fill="none"
                    stroke="var(--color-border)"
                    strokeWidth="14"
                    opacity={0.25}
                  />
                  {rate > 0 ? (
                    <circle
                      cx="60"
                      cy="60"
                      r={donutRadius}
                      fill="none"
                      stroke="var(--color-accent)"
                      strokeWidth="14"
                      strokeDasharray={`${(rate / 100) * donutCircumference} ${donutCircumference}`}
                      transform="rotate(-90 60 60)"
                    />
                  ) : null}
                  <text
                    x="60"
                    y="60"
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize="24"
                    fontWeight="700"
                    fill="var(--color-text)"
                  >
                    {rate}%
                  </text>
                </svg>
                <span style={mutedStyle}>{t("statDoneLabel")}</span>
              </div>

              <div
                style={{
                  flex: 1,
                  minWidth: 260,
                  display: "grid",
                  gap: "var(--space-xs)",
                }}
              >
                <span style={{ fontWeight: 700 }}>{t("trendTitle")}</span>
                <svg
                  viewBox="0 0 266 128"
                  role="img"
                  aria-label={t("trendTitle")}
                  style={{ width: "100%", maxWidth: 560, display: "block" }}
                >
                  <line
                    x1="2"
                    y1="96"
                    x2="264"
                    y2="96"
                    stroke="var(--color-border)"
                    strokeWidth="3"
                  />
                  {trend.map((bucket, index) => {
                    const groupX = 5 + index * 36;
                    const addedHeight =
                      bucket.added > 0
                        ? Math.max(4, Math.round((bucket.added / maxCount) * 80))
                        : 0;
                    const doneHeight =
                      bucket.completed > 0
                        ? Math.max(4, Math.round((bucket.completed / maxCount) * 80))
                        : 0;
                    return (
                      <g key={index}>
                        <title>{`${dayLabel(index)} · ${t("trendAdded")} ${bucket.added} · ${t("trendCompleted")} ${bucket.completed}`}</title>
                        {addedHeight > 0 ? (
                          <rect
                            x={groupX}
                            y={96 - addedHeight}
                            width="14"
                            height={addedHeight}
                            fill="var(--color-primary)"
                            stroke="var(--color-border)"
                            strokeWidth="2"
                          />
                        ) : null}
                        {doneHeight > 0 ? (
                          <rect
                            x={groupX + 18}
                            y={96 - doneHeight}
                            width="14"
                            height={doneHeight}
                            fill="var(--color-accent)"
                            stroke="var(--color-border)"
                            strokeWidth="2"
                          />
                        ) : null}
                        <text
                          x={groupX + 16}
                          y="116"
                          textAnchor="middle"
                          fontSize="10"
                          fill="var(--color-text-muted)"
                        >
                          {dayLabel(index)}
                        </text>
                      </g>
                    );
                  })}
                </svg>
                <div style={{ display: "flex", gap: "var(--space-md)" }}>
                  <span style={{ ...mutedStyle, display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <span aria-hidden="true" style={{ ...legendSwatchStyle, background: "var(--color-primary)" }} />
                    {t("trendAdded")}
                  </span>
                  <span style={{ ...mutedStyle, display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <span aria-hidden="true" style={{ ...legendSwatchStyle, background: "var(--color-accent)" }} />
                    {t("trendCompleted")}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 编辑弹窗：遮罩点击 / Esc / 关闭按钮均可退出。 */}
      {editing ? (
        <div className="todo-modal-overlay" onClick={cancelEdit}>
          <div
            className="todo-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="todo-edit-heading"
            onClick={(event) => event.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "var(--space-sm)",
              }}
            >
              <h3 id="todo-edit-heading" style={{ margin: 0 }}>
                {t("editTitle")}
              </h3>
              <button
                type="button"
                onClick={cancelEdit}
                aria-label={t("closeModal")}
                style={iconBtnStyle}
              >
                ×
              </button>
            </div>
            <div style={{ display: "grid", gap: "4px" }}>
              <label htmlFor="todo-edit-title-input" style={mutedStyle}>
                {t("titleLabel")}
              </label>
              <input
                ref={titleInputRef}
                id="todo-edit-title-input"
                type="text"
                value={editing.title}
                onChange={(event) =>
                  setEditing((current) =>
                    current ? { ...current, title: event.target.value } : current,
                  )
                }
                maxLength={200}
                style={inputStyle}
              />
            </div>
            <div style={{ display: "grid", gap: "4px" }}>
              <label htmlFor="todo-edit-note-input" style={mutedStyle}>
                {t("noteLabel")}
              </label>
              <textarea
                id="todo-edit-note-input"
                value={editing.note}
                onChange={(event) =>
                  setEditing((current) =>
                    current ? { ...current, note: event.target.value } : current,
                  )
                }
                placeholder={t("notePlaceholder")}
                maxLength={MAX_NOTE_LEN}
                rows={5}
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </div>
            <div
              style={{
                display: "flex",
                gap: "var(--space-sm)",
                justifyContent: "flex-end",
              }}
            >
              <button type="button" onClick={cancelEdit} className="btn btn--sm">
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={editing.title.trim().length === 0}
                className="btn btn--primary btn--sm"
              >
                {t("save")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * TODO List client. The storage backend follows the Clerk session:
 * signed-in users persist to /api/todo (cloud KV, isolated per account),
 * signed-out visitors get the same panel backed by localStorage. All
 * mutations apply optimistically and sync in the background; a 401 from
 * the API flips the panel into the expired state on its own.
 */
export default function TodoClient() {
  return <TodoPanel />;
}
