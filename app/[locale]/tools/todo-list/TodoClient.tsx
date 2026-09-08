"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { SignInButton, useUser } from "@clerk/nextjs";
import { MAX_ITEMS, MAX_NOTE_LEN, normalizeItems, statsSummary, type TodoItem } from "./utils";

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
 * null 表示载荷损坏或写入失败（调用方保持原状态或重读纠偏）。
 */
interface TodoStorage {
  load(): Promise<TodoItem[] | "unauthorized" | null>;
  add(title: string, note: string): Promise<TodoItem[] | "unauthorized" | null>;
  update(id: string, patch: TodoPatch): Promise<TodoItem[] | "unauthorized" | null>;
  remove(id: string): Promise<TodoItem[] | "unauthorized" | null>;
}

function cloudStorage(): TodoStorage {
  return {
    async load() {
      const { unauthorized, data } = await fetchItems("GET");
      return unauthorized ? "unauthorized" : data;
    },
    async add(title, note) {
      const { unauthorized, data } = await fetchItems("POST", { title, note });
      return unauthorized ? "unauthorized" : data;
    },
    async update(id, patch) {
      const { unauthorized, data } = await fetchItems("PATCH", { id, ...patch });
      return unauthorized ? "unauthorized" : data;
    },
    async remove(id) {
      const { unauthorized, data } = await fetchItems("DELETE", { id });
      return unauthorized ? "unauthorized" : data;
    },
  };
}

const LOCAL_KEY = "lucky-todo-local-v1";

function readLocalItems(): TodoItem[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    return raw ? (normalizeItems(JSON.parse(raw)) ?? []) : [];
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
              ...(patch.done === undefined ? null : { done: patch.done }),
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

/**
 * 清单面板：后端跟随 Clerk 登录态（云端 KV / 本地浏览器）。初始加载
 * 一次；增删改均先本地乐观更新，再用存储回包覆盖（回包异常时重读
 * 纠偏）。
 */
function TodoPanel() {
  const t = useTranslations("tools.todo");
  // Clerk 会话解析完成前不选择后端，避免登录用户闪现本地模式。
  const { isLoaded, isSignedIn } = useUser();

  const [items, setItems] = useState<TodoItem[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "expired">("loading");
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editNote, setEditNote] = useState("");
  // 最近一次成功写入的本地时间戳（null = 本次会话尚未写入）。
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // 卸载后丢弃过期响应，避免对已卸载组件 setState。
  const aliveRef = useRef(true);

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

  /** 写入成功路径：覆盖清单并记录更新时间。 */
  const commit = useCallback((data: TodoItem[] | null) => {
    if (!data) return false;
    setItems(data);
    setStatus("ready");
    setSavedAt(Date.now());
    return true;
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

  const add = useCallback(async () => {
    const title = draft.trim();
    if (!title || pending) return;
    setPending(true);
    try {
      const result = await storage.add(title, "");
      if (!aliveRef.current) return;
      if (result === "unauthorized") {
        setStatus("expired");
        return;
      }
      if (commit(result)) setDraft("");
      else setStatus("error");
    } catch {
      if (aliveRef.current) setStatus("error");
    } finally {
      if (aliveRef.current) setPending(false);
    }
  }, [draft, pending, storage, commit]);

  const toggle = useCallback(
    async (item: TodoItem) => {
      // 乐观切换 done，存储回包到达后覆盖。
      setItems((current) =>
        current
          ? current.map((entry) =>
              entry.id === item.id ? { ...entry, done: !entry.done } : entry,
            )
          : current,
      );
      try {
        const result = await storage.update(item.id, { done: !item.done });
        if (!aliveRef.current) return;
        if (result === "unauthorized") {
          setStatus("expired");
          return;
        }
        // 回包异常（结构损坏）时重读纠偏。
        if (!commit(result)) load();
      } catch {
        if (aliveRef.current) load();
      }
    },
    [storage, commit, load],
  );

  const remove = useCallback(
    async (id: string) => {
      // 乐观移除，存储回包到达后覆盖。
      setItems((current) => (current ? current.filter((entry) => entry.id !== id) : current));
      if (editingId === id) setEditingId(null);
      try {
        const result = await storage.remove(id);
        if (!aliveRef.current) return;
        if (result === "unauthorized") {
          setStatus("expired");
          return;
        }
        commit(result);
      } catch {
        if (aliveRef.current) load();
      }
    },
    [editingId, storage, commit, load],
  );

  const startEdit = useCallback((item: TodoItem) => {
    setEditingId(item.id);
    setEditTitle(item.title);
    setEditNote(item.note);
  }, []);

  const cancelEdit = useCallback(() => setEditingId(null), []);

  const saveEdit = useCallback(async () => {
    const id = editingId;
    const title = editTitle.trim();
    if (!id || !title || pending) return;
    setPending(true);
    try {
      const result = await storage.update(id, { title, note: editNote });
      if (!aliveRef.current) return;
      if (result === "unauthorized") {
        setStatus("expired");
        return;
      }
      if (commit(result)) setEditingId(null);
      else load();
    } catch {
      if (aliveRef.current) load();
    } finally {
      if (aliveRef.current) setPending(false);
    }
  }, [editingId, editTitle, editNote, pending, storage, commit, load]);

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

  return (
    <section style={cardStyle}>
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
          disabled={pending || draft.trim().length === 0}
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
        {items.map((item) => {
          const expanded = editingId === item.id;
          return (
            <li
              key={item.id}
              style={{
                ...rowStyle,
                flexDirection: "column",
                alignItems: "stretch",
                gap: "var(--space-xs)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
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
                  onClick={() => (expanded ? cancelEdit() : startEdit(item))}
                  aria-expanded={expanded}
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
              </div>
              {expanded ? (
                <div style={{ display: "grid", gap: "var(--space-xs)", padding: "0 var(--space-xs)" }}>
                  <div style={{ display: "grid", gap: "4px" }}>
                    <span style={mutedStyle}>{t("titleLabel")}</span>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(event) => setEditTitle(event.target.value)}
                      aria-label={t("titleLabel")}
                      maxLength={200}
                      style={inputStyle}
                    />
                  </div>
                  <div style={{ display: "grid", gap: "4px" }}>
                    <span style={mutedStyle}>{t("noteLabel")}</span>
                    <textarea
                      value={editNote}
                      onChange={(event) => setEditNote(event.target.value)}
                      placeholder={t("notePlaceholder")}
                      aria-label={t("noteLabel")}
                      maxLength={MAX_NOTE_LEN}
                      rows={3}
                      style={{ ...inputStyle, resize: "vertical" }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: "var(--space-sm)" }}>
                    <button
                      type="button"
                      onClick={saveEdit}
                      disabled={pending || editTitle.trim().length === 0}
                      className="btn btn--primary btn--sm"
                    >
                      {t("save")}
                    </button>
                    <button type="button" onClick={cancelEdit} className="btn btn--sm">
                      {t("cancel")}
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {/* 状态监控区：完成进度、待办数、数据来源、最近更新。 */}
      <div style={{ marginTop: "var(--space-md)", display: "grid", gap: "var(--space-xs)" }}>
        {stats.total > 0 ? (
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
            <span style={{ ...mutedStyle, flex: "none" }}>
              {t("statsProgress", { done: stats.done, total: stats.total })}
            </span>
            <span
              aria-hidden="true"
              style={{
                flex: 1,
                display: "block",
                height: 10,
                border: "3px solid var(--color-border)",
                borderRadius: "var(--radius-sm)",
                background: "var(--color-surface)",
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  display: "block",
                  height: "100%",
                  width: `${rate}%`,
                  background: "var(--color-btn-primary)",
                  transition: "width 200ms ease-out",
                }}
              />
            </span>
            <span style={{ ...mutedStyle, flex: "none" }}>{t("statsRate", { rate })}</span>
          </div>
        ) : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-xs) var(--space-md)" }}>
          <span style={mutedStyle}>
            {t("storageSource", { source: isSignedIn ? t("storageCloud") : t("storageLocal") })}
          </span>
          <span style={mutedStyle}>
            {savedAt
              ? t("lastSaved", { time: new Date(savedAt).toLocaleTimeString() })
              : t("neverSaved")}
          </span>
          <span style={mutedStyle}>{t("statsPending", { count: stats.pending })}</span>
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
    </section>
  );
}

/**
 * TODO List client. The storage backend follows the Clerk session:
 * signed-in users persist to /api/todo (cloud KV, isolated per account),
 * signed-out visitors get the same panel backed by localStorage. A 401
 * from the API flips the panel into the expired state on its own.
 */
export default function TodoClient() {
  return <TodoPanel />;
}
