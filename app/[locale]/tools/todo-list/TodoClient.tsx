"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { SignInButton, useUser } from "@clerk/nextjs";
import {
  MAX_GROUP_LEN,
  MAX_ITEMS,
  MAX_NOTE_LEN,
  applyReorder,
  formatDateValue,
  formatDateTimeValue,
  groupSections,
  isOverdue,
  normalizeItems,
  parseDateValue,
  parseDateTimeValue,
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
async function fetchItems(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  body?: unknown,
) {
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
type TodoPatch = {
  title?: string;
  note?: string;
  done?: boolean;
  dueAt?: number;
  remindAt?: number;
  priority?: number;
  group?: string;
};

/** 新建条目的四要素载荷（标题必填，其余可选）。 */
interface TodoDraft {
  title: string;
  note: string;
  dueAt: number;
  remindAt: number;
  priority: number;
  group: string;
}

/**
 * 存储后端统一接口。登录用户走 /api/todo（云端 KV、按账号隔离），
 * 未登录访客走 localStorage（仅当前浏览器）。每个方法返回写入后的
 * 最新清单；"unauthorized" 表示云端会话失效（翻入 expired 状态）；
 * null 表示载荷损坏或写入失败（调用方重读纠偏）。
 */
interface TodoStorage {
  load(): Promise<TodoItem[] | "unauthorized" | null>;
  add(draft: TodoDraft): Promise<TodoItem[] | "unauthorized" | null>;
  update(id: string, patch: TodoPatch): Promise<TodoItem[] | "unauthorized" | null>;
  remove(id: string): Promise<TodoItem[] | "unauthorized" | null>;
  /** 按给定 id 顺序重写清单；groups 仅携带分组发生变化的条目。 */
  reorder(
    order: string[],
    groups: Record<string, string>,
  ): Promise<TodoItem[] | "unauthorized" | null>;
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
    async add(draft) {
      const { unauthorized, data } = await enqueue(() =>
        fetchItems("POST", { createdAt: Date.now(), ...draft }),
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
    async reorder(order, groups) {
      const { unauthorized, data } = await enqueue(() =>
        fetchItems("PUT", { order, groups }),
      );
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

function makeLocalItem(draft: TodoDraft): TodoItem {
  // 与边缘函数 makeItemId 同构：base36 时间戳 + 短随机段。
  const now = Date.now();
  return {
    id: `${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    title: draft.title,
    note: draft.note,
    done: false,
    createdAt: now,
    completedAt: 0,
    dueAt: draft.dueAt,
    remindAt: draft.remindAt,
    priority: draft.priority,
    group: draft.group,
  };
}

function localBackend(): TodoStorage {
  return {
    async load() {
      return readLocalItems();
    },
    async add(draft) {
      return writeLocalItems([makeLocalItem(draft), ...readLocalItems()]);
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
              ...(patch.dueAt === undefined ? null : { dueAt: patch.dueAt }),
              ...(patch.remindAt === undefined ? null : { remindAt: patch.remindAt }),
              ...(patch.priority === undefined ? null : { priority: patch.priority }),
              ...(patch.group === undefined ? null : { group: patch.group }),
            }
          : item,
      );
      return writeLocalItems(next);
    },
    async remove(id) {
      return writeLocalItems(readLocalItems().filter((item) => item.id !== id));
    },
    async reorder(order, groups) {
      // 与边缘函数 reorderTodos 同构：按 order 排列、改写分组，
      // 未覆盖的条目保持原相对顺序追加在尾部。
      const items = readLocalItems();
      const byId = new Map(items.map((item) => [item.id, item]));
      const next: TodoItem[] = [];
      const covered = new Set<string>();
      for (const id of order) {
        const item = byId.get(id);
        if (!item) continue;
        covered.add(id);
        next.push(
          Object.prototype.hasOwnProperty.call(groups, id)
            ? { ...item, group: groups[id] }
            : item,
        );
      }
      for (const item of items) {
        if (!covered.has(item.id)) next.push(item);
      }
      return writeLocalItems(next);
    },
  };
}

/** 同步指示器状态机：静默 → 进行中 → 已同步 / 失败（已触发重读纠偏）。 */
type SyncState = "idle" | "syncing" | "saved" | "error";

/** 编辑弹窗载荷；null = 弹窗关闭。四要素 + 分组一并编辑。 */
interface EditDraft {
  id: string;
  title: string;
  note: string;
  dueAt: number;
  remindAt: number;
  priority: number;
  group: string;
}

/** 拖拽落点提示：目标分组 + 组内插入槽位（按含拖拽项的渲染列表计）。 */
interface DropHint {
  group: string;
  at: number;
}

/** 优先级 → 文案键（0 不展示徽标，无需键）。 */
function priorityKey(priority: number): "priorityLow" | "priorityMedium" | "priorityHigh" {
  if (priority >= 3) return "priorityHigh";
  if (priority === 2) return "priorityMedium";
  return "priorityLow";
}

/** 拖拽手柄的内联 SVG（六点握把）。 */
function GripIcon() {
  return (
    <svg width="12" height="16" viewBox="0 0 12 16" aria-hidden="true" focusable="false">
      <circle cx="3" cy="3" r="1.6" fill="currentColor" />
      <circle cx="9" cy="3" r="1.6" fill="currentColor" />
      <circle cx="3" cy="8" r="1.6" fill="currentColor" />
      <circle cx="9" cy="8" r="1.6" fill="currentColor" />
      <circle cx="3" cy="13" r="1.6" fill="currentColor" />
      <circle cx="9" cy="13" r="1.6" fill="currentColor" />
    </svg>
  );
}

/**
 * 清单面板：后端跟随 Clerk 登录态（云端 KV / 本地浏览器）。初始加载
 * 一次；增删改与拖拽排序均先本地乐观更新（UI 即时反馈），写入在后台
 * 串行执行，由同步指示器反馈结果；回包异常时重读存储纠偏。
 */
function TodoPanel() {
  const t = useTranslations("tools.todo");
  // Clerk 会话解析完成前不选择后端，避免登录用户闪现本地模式。
  const { isLoaded, isSignedIn } = useUser();

  const [items, setItems] = useState<TodoItem[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "expired">("loading");
  const [draft, setDraft] = useState("");
  const [draftPriority, setDraftPriority] = useState(0);
  const [tab, setTab] = useState<"list" | "stats">("list");
  const [editing, setEditing] = useState<EditDraft | null>(null);
  const [sync, setSync] = useState<SyncState>("idle");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragHint, setDragHint] = useState<DropHint | null>(null);
  // 拖拽链路用 ref 跨回调携带被拖条目 id（state 会被提前清空）。
  const dragIdRef = useRef<string | null>(null);
  // onUp 闭包拿不到最新 dragHint（state），用 ref 镜像最新落点提示。
  const dragHintRef = useRef<DropHint | null>(null);
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
    const newDraft: TodoDraft = {
      title,
      note: "",
      dueAt: 0,
      remindAt: 0,
      priority: draftPriority,
      group: "",
    };
    // 乐观插入临时条目（本地同构 id），存储回包到达后整体覆盖。
    const optimistic = makeLocalItem(newDraft);
    setDraft("");
    setDraftPriority(0);
    setStatus("ready");
    setItems((current) => (current ? [optimistic, ...current] : [optimistic]));
    runWrite(() => storage.add(newDraft));
  }, [draft, draftPriority, storage, runWrite]);

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
    setEditing({
      id: item.id,
      title: item.title,
      note: item.note,
      dueAt: item.dueAt,
      remindAt: item.remindAt,
      priority: item.priority,
      group: item.group,
    });
  }, []);

  const cancelEdit = useCallback(() => setEditing(null), []);

  const saveEdit = useCallback(() => {
    if (!editing) return;
    const title = editing.title.trim();
    if (!title) return;
    const { id, note, dueAt, remindAt, priority } = editing;
    const group = editing.group.trim();
    setEditing(null);
    // 乐观写回全部字段，存储回包到达后整体覆盖。
    setItems((current) =>
      current
        ? current.map((entry) =>
            entry.id === id ? { ...entry, title, note, dueAt, remindAt, priority, group } : entry,
          )
        : current,
    );
    runWrite(() => storage.update(id, { title, note, dueAt, remindAt, priority, group }));
  }, [editing, storage, runWrite]);

  /**
   * 提交一次重排：清单无变化时静默跳过；否则乐观覆盖并走 PUT 通道，
   * groups 仅携带分组发生变化的条目（服务端按 id 顺序重写数组）。
   */
  const commitReorder = useCallback(
    (next: TodoItem[] | null) => {
      if (!next || !items) return;
      const signature = (list: TodoItem[]) =>
        list.map((item) => `${item.id}:${item.group}`).join("|");
      if (signature(next) === signature(items)) return;
      const before = new Map(items.map((item) => [item.id, item]));
      const groups: Record<string, string> = {};
      for (const item of next) {
        const prev = before.get(item.id);
        if (prev && prev.group !== item.group) groups[item.id] = item.group;
      }
      setItems(next);
      runWrite(() => storage.reorder(next.map((item) => item.id), groups));
    },
    [items, storage, runWrite],
  );

  /** 键盘替代排序：沿渲染顺序上/下移动一个槽位（可跨分组）。 */
  const moveBy = useCallback(
    (id: string, delta: number) => {
      if (!items) return;
      const flat: { id: string; group: string; at: number }[] = [];
      for (const section of groupSections(items)) {
        section.items.forEach((item, index) =>
          flat.push({ id: item.id, group: section.name, at: index }),
        );
      }
      const from = flat.findIndex((entry) => entry.id === id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= flat.length) return;
      const target = flat[to];
      // 下移时插到目标之后；上移时插到目标之前（槽位按含拖拽项列表计）。
      commitReorder(applyReorder(items, id, target.group, delta > 0 ? target.at + 1 : target.at));
    },
    [items, commitReorder],
  );

  // 已有分组的名称列表（供编辑弹窗 datalist 联想）；须置于 early-return 之前以守住 hooks 顺序。
  const groupNames = useMemo(
    () => [...new Set((items ?? []).map((item) => item.group).filter((name) => name !== ""))],
    [items],
  );

  const onGripPointerDown = useCallback((event: React.PointerEvent, id: string) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragIdRef.current = id;
    setDragId(id);
  }, []);

  // 拖拽进行中：监听窗口级 pointermove/up，命中测试计算落点提示。
  useEffect(() => {
    if (!dragId) return undefined;
    const hitTest = (x: number, y: number): DropHint | null => {
      const under = document.elementFromPoint(x, y);
      if (!under) return null;
      const row = under.closest<HTMLElement>("[data-todo-id]");
      if (row) {
        if (row.dataset.todoId === dragId) return null;
        const index = Number(row.dataset.todoIdx ?? "0");
        const rect = row.getBoundingClientRect();
        return {
          group: row.dataset.todoGroup ?? "",
          at: index + (y > rect.top + rect.height / 2 ? 1 : 0),
        };
      }
      // 命中分组空区（组头/组容器）：追加到该组末尾。
      const zone = under.closest<HTMLElement>("[data-todo-zone]");
      if (zone) {
        return {
          group: zone.dataset.todoZone ?? "",
          at: Number(zone.dataset.todoCount ?? "0"),
        };
      }
      return null;
    };
    const onMove = (event: PointerEvent) => {
      const hint = hitTest(event.clientX, event.clientY);
      dragHintRef.current = hint;
      setDragHint((current) =>
        current?.group === hint?.group && current?.at === hint?.at ? current : hint,
      );
    };
    // 松手：在事件处理器内直接提交重排（避免在 effect 体内同步 setState）。
    const onUp = () => {
      const id = dragIdRef.current;
      const hint = dragHintRef.current;
      dragIdRef.current = null;
      dragHintRef.current = null;
      setDragId(null);
      setDragHint(null);
      if (id && hint && items) commitReorder(applyReorder(items, id, hint.group, hint.at));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragId, items, commitReorder]);

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
  const sections = groupSections(items);

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
            className="todo-add"
            onSubmit={(event) => {
              event.preventDefault();
              add();
            }}
          >
            <input
              type="text"
              className="todo-add-input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t("inputPlaceholder")}
              aria-label={t("inputPlaceholder")}
              maxLength={200}
            />
            <select
              className="todo-prio-select"
              value={draftPriority}
              onChange={(event) => setDraftPriority(Number(event.target.value))}
              aria-label={t("priorityLabel")}
            >
              <option value={0}>{t("priorityNone")}</option>
              <option value={1}>{t("priorityLow")}</option>
              <option value={2}>{t("priorityMedium")}</option>
              <option value={3}>{t("priorityHigh")}</option>
            </select>
            <button
              type="submit"
              disabled={draft.trim().length === 0}
              className="btn btn--primary btn--sm"
            >
              {t("add")}
            </button>
          </form>
          {items.length === 0 ? <p style={mutedStyle}>{t("empty")}</p> : null}
          {items.length > 0 ? <p className="todo-dnd-hint">{t("keyboardHint")}</p> : null}

          {sections.map((section) => {
            const hintAt =
              dragHint && dragHint.group === section.name ? dragHint.at : null;
            return (
              <section
                key={section.name === "" ? "__default__" : section.name}
                className="todo-group"
              >
                <header className="todo-group-head">
                  <span className="todo-group-name">
                    {section.name === "" ? t("defaultGroup") : section.name}
                  </span>
                  <span className="todo-group-count">{section.items.length}</span>
                </header>
                <ul
                  className="todo-list"
                  data-todo-zone={section.name}
                  data-todo-count={section.items.length}
                >
                  {section.items.map((item, index) => {
                    const overdue = isOverdue(item, Date.now());
                    const dragging = item.id === dragId;
                    return (
                      <Fragment key={item.id}>
                        {hintAt === index ? (
                          <li className="todo-drop-line" aria-hidden="true" />
                        ) : null}
                        <li
                          className={dragging ? "todo-item todo-item--dragging" : "todo-item"}
                          data-todo-id={item.id}
                          data-todo-group={section.name}
                          data-todo-idx={index}
                        >
                          <button
                            type="button"
                            className="todo-grip"
                            aria-label={t("moveItem", { title: item.title })}
                            onPointerDown={(event) => onGripPointerDown(event, item.id)}
                            onKeyDown={(event) => {
                              if (event.key === "ArrowUp") {
                                event.preventDefault();
                                moveBy(item.id, -1);
                              } else if (event.key === "ArrowDown") {
                                event.preventDefault();
                                moveBy(item.id, 1);
                              }
                            }}
                          >
                            <GripIcon />
                          </button>
                          <input
                            type="checkbox"
                            className="todo-check"
                            checked={item.done}
                            onChange={() => toggle(item)}
                            aria-label={item.title}
                          />
                          <div className="todo-item-main">
                            <span
                              className={
                                item.done
                                  ? "todo-item-title todo-item-title--done"
                                  : "todo-item-title"
                              }
                            >
                              {item.title}
                            </span>
                            {item.priority > 0 ||
                            item.dueAt > 0 ||
                            item.remindAt > 0 ||
                            item.note ? (
                              <span className="todo-item-meta">
                                {item.priority > 0 ? (
                                  <span
                                    className={`todo-prio todo-prio--${item.priority}`}
                                  >
                                    {t(priorityKey(item.priority))}
                                  </span>
                                ) : null}
                                {item.dueAt > 0 ? (
                                  <span
                                    className={
                                      overdue
                                        ? "todo-badge todo-badge--overdue"
                                        : "todo-badge"
                                    }
                                  >
                                    {overdue
                                      ? `${t("dueBadge", { date: new Date(item.dueAt).toLocaleDateString(undefined, { month: "numeric", day: "numeric" }) })} · ${t("overdueBadge")}`
                                      : t("dueBadge", {
                                          date: new Date(item.dueAt).toLocaleDateString(
                                            undefined,
                                            { month: "numeric", day: "numeric" },
                                          ),
                                        })}
                                  </span>
                                ) : null}
                                {item.remindAt > 0 ? (
                                  <span className="todo-badge">
                                    {t("remindBadge", {
                                      time: new Date(item.remindAt).toLocaleString(
                                        undefined,
                                        {
                                          month: "numeric",
                                          day: "numeric",
                                          hour: "2-digit",
                                          minute: "2-digit",
                                        },
                                      ),
                                    })}
                                  </span>
                                ) : null}
                                {item.note ? (
                                  <span
                                    className="todo-badge"
                                    aria-hidden="true"
                                    title={item.note}
                                  >
                                    ✎
                                  </span>
                                ) : null}
                              </span>
                            ) : null}
                          </div>
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
                      </Fragment>
                    );
                  })}
                  {hintAt === section.items.length ? (
                    <li className="todo-drop-line" aria-hidden="true" />
                  ) : null}
                </ul>
              </section>
            );
          })}

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

      {/* 编辑弹窗：四要素 + 分组；遮罩点击 / Esc / 关闭按钮均可退出。 */}
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
            <div className="todo-modal-grid">
              <div style={{ display: "grid", gap: "4px" }}>
                <label htmlFor="todo-edit-due-input" style={mutedStyle}>
                  {t("dueLabel")}
                </label>
                <input
                  id="todo-edit-due-input"
                  type="date"
                  value={formatDateValue(editing.dueAt)}
                  onChange={(event) =>
                    setEditing((current) =>
                      current ? { ...current, dueAt: parseDateValue(event.target.value) } : current,
                    )
                  }
                  style={inputStyle}
                />
              </div>
              <div style={{ display: "grid", gap: "4px" }}>
                <label htmlFor="todo-edit-remind-input" style={mutedStyle}>
                  {t("remindLabel")}
                </label>
                <input
                  id="todo-edit-remind-input"
                  type="datetime-local"
                  value={formatDateTimeValue(editing.remindAt)}
                  onChange={(event) =>
                    setEditing((current) =>
                      current
                        ? { ...current, remindAt: parseDateTimeValue(event.target.value) }
                        : current,
                    )
                  }
                  style={inputStyle}
                />
              </div>
              <div style={{ display: "grid", gap: "4px" }}>
                <label htmlFor="todo-edit-priority-input" style={mutedStyle}>
                  {t("priorityLabel")}
                </label>
                <select
                  id="todo-edit-priority-input"
                  value={editing.priority}
                  onChange={(event) =>
                    setEditing((current) =>
                      current ? { ...current, priority: Number(event.target.value) } : current,
                    )
                  }
                  style={inputStyle}
                >
                  <option value={0}>{t("priorityNone")}</option>
                  <option value={1}>{t("priorityLow")}</option>
                  <option value={2}>{t("priorityMedium")}</option>
                  <option value={3}>{t("priorityHigh")}</option>
                </select>
              </div>
              <div style={{ display: "grid", gap: "4px" }}>
                <label htmlFor="todo-edit-group-input" style={mutedStyle}>
                  {t("groupLabel")}
                </label>
                <input
                  id="todo-edit-group-input"
                  type="text"
                  list="todo-group-options"
                  value={editing.group}
                  onChange={(event) =>
                    setEditing((current) =>
                      current ? { ...current, group: event.target.value } : current,
                    )
                  }
                  placeholder={t("groupPlaceholder")}
                  maxLength={MAX_GROUP_LEN}
                  style={inputStyle}
                />
                <datalist id="todo-group-options">
                  {groupNames.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>
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
 * signed-out visitors get the same panel backed by localStorage. Items
 * carry four elements (title, note, due/remind stamps, priority) plus a
 * free-form group; rows support pointer drag-and-drop and keyboard
 * reordering. All mutations apply optimistically and sync in the
 * background; a 401 from the API flips the panel into the expired state.
 */
export default function TodoClient() {
  return <TodoPanel />;
}
