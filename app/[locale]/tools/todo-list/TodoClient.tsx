"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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

/**
 * 调用 /api/todo：body 缺省时发无载荷请求（GET），否则发 JSON。
 * keepalive 供页面卸载路径（pagehide/隐藏冲刷）使用，请求在页面关闭后
 * 仍会送达。
 */
async function fetchItems(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  body?: unknown,
  keepalive = false,
) {
  const res = await fetch("/api/todo", {
    method,
    cache: "no-store",
    keepalive,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) return { unauthorized: true as const, data: null };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { unauthorized: false as const, data: normalizeItems(await res.json()) };
}

/** 新建条目的四要素载荷（标题必填，其余可选）。 */
interface TodoDraft {
  title: string;
  note: string;
  dueAt: number;
  remindAt: number;
  priority: number;
  group: string;
}

const LOCAL_KEY = "lucky-todo-local-v1";

/** 访客本地清单读取：兼容 { items } 包装与裸数组两种历史格式。 */
function readLocalItems(): TodoItem[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
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

/** 云端镜像键：按账号隔离（uid 消毒后作后缀）。 */
function cloudMirrorKey(uid: string): string {
  return `lucky-todo-cloud-v1-${uid.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

/**
 * 云端镜像读取：{ items, dirty } 包装；缺失/畸形返回 null。dirty 表示
 * 有本地改动尚未上传——离线/关页后重开也能补传，数据不丢。
 */
function readCloudMirror(key: string): { items: TodoItem[]; dirty: boolean } | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const wrapper = parsed as { items?: unknown; dirty?: unknown } | null;
    if (!Array.isArray(wrapper?.items)) return null;
    return {
      items: normalizeItems({ items: wrapper.items }) ?? [],
      dirty: wrapper.dirty === true,
    };
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

/**
 * 同步指示器状态机（写后队列）：
 * idle 静默 → pending 已标脏等待防抖 → saving 上传中 →
 * saved 绿勾确认 / error 红叉报错（改动保留在本地，可重试）。
 */
type SyncState = "idle" | "pending" | "saving" | "saved" | "error";

/** 冲刷防抖间隔：连续操作合并为一轮网络写入。 */
const FLUSH_DEBOUNCE_MS = 800;

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
 * 清单面板（写后队列架构）：内存 items 是唯一事实源，一切增删改/排序
 * 只做本地内存操作（UI 即时生效），网络上传是后台异步任务——变更先落
 * localStorage 镜像并标脏，800ms 防抖后用 PUT 全量快照合并上传；冲刷
 * 期间的新改动在完成后链式补传。网络结果只通过同步指示器呈现（绿勾/
 * 红叉），绝不用服务端回包覆盖本地列表。云端模式加载走 SWR：镜像先
 * 上屏（秒开），后台对账仅在无未上传改动时采纳服务端清单。
 */
function TodoPanel() {
  const t = useTranslations("tools.todo");
  // Clerk 会话解析完成前不选择存储上下文，避免登录用户闪现本地模式。
  const { isLoaded, isSignedIn, user } = useUser();
  // 以稳定字符串（而非 user 对象）作依赖，避免 Clerk 对象引用抖动。
  const userId = isSignedIn ? (user?.id ?? "") : "";

  const [items, setItems] = useState<TodoItem[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "expired">("loading");
  const [draft, setDraft] = useState("");
  const [draftPriority, setDraftPriority] = useState(0);
  const [tab, setTab] = useState<"list" | "stats">("list");
  const [editing, setEditing] = useState<EditDraft | null>(null);
  const [sync, setSync] = useState<SyncState>("idle");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragHint, setDragHint] = useState<DropHint | null>(null);
  // 最近一次成功写入的本地时间戳（null = 本次会话尚未写入）。
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // 趋势分桶基准时刻：挂载时取一次即可（7 天粒度无需实时走秒）。
  const [now] = useState(() => Date.now());

  // 卸载后丢弃过期响应，避免对已卸载组件 setState。
  const aliveRef = useRef(true);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const listTabRef = useRef<HTMLButtonElement | null>(null);
  const statsTabRef = useRef<HTMLButtonElement | null>(null);

  // ---- 同步层 refs：内存清单镜像 + 脏标记 + 冲刷调度 ----
  const itemsRef = useRef<TodoItem[] | null>(null);
  const dirtyRef = useRef(false);
  const inflightRef = useRef(false);
  const flushTimerRef = useRef(0);
  // flush 的自引用中转（immutability 规则禁止 useCallback 内直接引用自身）。
  const flushRef = useRef<() => void>(() => {});

  // ---- 拖拽层 refs：像素级反馈绕过 React，state 只承载语义变化 ----
  // 拖拽链路用 ref 跨回调携带被拖条目 id（state 会被提前清空）。
  const dragIdRef = useRef<string | null>(null);
  // 拖拽会话的起点（指针位置 + 页面滚动基准 + 被拖行元素）。
  const dragStartRef = useRef<{
    px: number;
    py: number;
    sy0: number;
    el: HTMLElement;
  } | null>(null);
  // 最新指针位置（rAF 帧内消费，pointermove 只写不渲染）。
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  // 命中测试去重门：指针未动且页面未滚则跳过 elementFromPoint。
  const lastTestRef = useRef<{ x: number; y: number; sy: number } | null>(null);
  // onUp 闭包拿不到最新 dragHint（state），用 ref 镜像最新落点提示。
  const dragHintRef = useRef<DropHint | null>(null);
  const rafRef = useRef(0);
  // FLIP 布局快照：各行上次渲染的文档坐标 top。
  const rectsRef = useRef<Map<string, number>>(new Map());
  // 刚松手的行 + 松手时刻视觉偏移（FLIP 从指针位置平滑落位/归位）。
  const lastDropRef = useRef<{ id: string | null; dy: number } | null>(null);

  /**
   * localStorage 持久化：访客写裸数组（既有格式）；登录用户写云端镜像
   * { items, dirty }（脏标记持久化 → 离线/关页后重开自动补传）。
   * 镜像写失败（配额溢出等）不阻断内存事实源。
   */
  const persist = useCallback((list: TodoItem[], dirty: boolean) => {
    try {
      const payload = userId ? { items: list, dirty } : list;
      window.localStorage.setItem(
        userId ? cloudMirrorKey(userId) : LOCAL_KEY,
        JSON.stringify(payload),
      );
    } catch {
      // 静默：内存清单仍然有效。
    }
  }, [userId]);

  /**
   * 后台冲刷：把内存快照 PUT 全量替换到云端（合并写入口，last-write-
   * wins）。无论成败都不回读响应体覆盖本地——网络延迟只体现在指示器。
   * 失败保留脏标记（改动不丢），仅翻 error 态等待重试；401 翻过期屏。
   */
  const flush = useCallback(async () => {
    if (!userId || !dirtyRef.current || inflightRef.current) return;
    inflightRef.current = true;
    setSync("saving");
    try {
      const { unauthorized } = await fetchItems(
        "PUT",
        { items: itemsRef.current ?? [] },
        true,
      );
      if (!aliveRef.current) return;
      if (unauthorized) {
        setStatus("expired");
        return;
      }
      dirtyRef.current = false;
      persist(itemsRef.current ?? [], false);
      setSavedAt(Date.now());
      setSync("saved");
    } catch {
      if (!aliveRef.current) return;
      setSync("error");
    } finally {
      inflightRef.current = false;
    }
    // 冲刷期间又有新改动：立即补一轮（写后队列收敛）。
    if (aliveRef.current && dirtyRef.current) {
      flushTimerRef.current = window.setTimeout(() => {
        flushTimerRef.current = 0;
        flushRef.current();
      }, 0);
    }
  }, [userId, persist]);

  // 把最新 flush 接到中转 ref 上，供链式补传调用。
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  /** 防抖调度一次冲刷；delay = 0 立即执行（重试/关页/开机补传路径）。 */
  const scheduleFlush = useCallback(
    (delay = FLUSH_DEBOUNCE_MS) => {
      if (!userId) return;
      if (flushTimerRef.current) window.clearTimeout(flushTimerRef.current);
      if (delay > 0) {
        setSync((current) => (current === "saving" ? current : "pending"));
        flushTimerRef.current = window.setTimeout(() => {
          flushTimerRef.current = 0;
          void flush();
        }, delay);
      } else {
        void flush();
      }
    },
    [userId, flush],
  );

  /**
   * 唯一写出口：UI 一切变更只改内存（同步生效）+ 落镜像 + 标脏并调度
   * 后台冲刷。网络请求完全不进入交互路径——操作本身的响应速度等于
   * 本地内存操作。
   */
  const commit = useCallback(
    (next: TodoItem[]) => {
      const capped = next.slice(0, MAX_ITEMS);
      itemsRef.current = capped;
      setItems(capped);
      if (!userId) {
        persist(capped, false);
        setSavedAt(Date.now());
        setSync("saved");
        return;
      }
      dirtyRef.current = true;
      persist(capped, true);
      scheduleFlush();
    },
    [userId, persist, scheduleFlush],
  );

  /**
   * SWR 加载：云端模式先上屏本地镜像（秒开），再后台对账——仅当没有
   * 未上传改动时才采纳服务端清单（本地未上传的改动优先）；带脏标记
   * 开机则立即补传。访客直接同步读本地。可安全重复调用（重试按钮）。
   */
  const load = useCallback(() => {
    if (!userId) {
      dirtyRef.current = false;
      const local = readLocalItems();
      itemsRef.current = local;
      setItems(local);
      setStatus("ready");
      return;
    }
    const mirror = readCloudMirror(cloudMirrorKey(userId));
    dirtyRef.current = mirror?.dirty ?? false;
    if (mirror && mirror.items.length > 0) {
      itemsRef.current = mirror.items;
      setItems(mirror.items);
      setStatus("ready");
    }
    void (async () => {
      try {
        const { unauthorized, data } = await fetchItems("GET");
        if (!aliveRef.current) return;
        if (unauthorized) {
          setStatus("expired");
          return;
        }
        // 本地有未上传改动：内存是事实源，跳过对账（冲刷会推走快照）。
        if (dirtyRef.current) return;
        if (data) {
          const current = itemsRef.current;
          if (!current || JSON.stringify(current) !== JSON.stringify(data)) {
            itemsRef.current = data;
            setItems(data);
            persist(data, false);
          }
          setStatus("ready");
        }
      } catch {
        // 对账失败：已有镜像则离线可用（维持现状），否则翻错误态。
        if (aliveRef.current && itemsRef.current === null) setStatus("error");
      }
    })();
    if (dirtyRef.current) scheduleFlush(0);
  }, [userId, persist, scheduleFlush]);

  useEffect(() => {
    if (!isLoaded) return undefined;
    aliveRef.current = true;
    // 首次拉取异步启动（react-hooks 禁止在 effect 体内同步进入 setState
    // 路径）。
    const kickoff = setTimeout(load, 0);
    return () => {
      aliveRef.current = false;
      clearTimeout(kickoff);
      if (flushTimerRef.current) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = 0;
      }
    };
  }, [load, isLoaded]);

  // 关页/切后台：立即冲刷脏改动（keepalive 让请求在页面卸载后仍送达）。
  useEffect(() => {
    const flushNow = () => {
      if (dirtyRef.current) scheduleFlush(0);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushNow();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flushNow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flushNow);
    };
  }, [scheduleFlush]);

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
    setDraft("");
    setDraftPriority(0);
    setStatus("ready");
    commit([makeLocalItem(newDraft), ...(itemsRef.current ?? [])]);
  }, [draft, draftPriority, commit]);

  const toggle = useCallback(
    (item: TodoItem) => {
      const nextDone = !item.done;
      // done 切换联动完成时间，与边缘函数语义一致。
      commit(
        (itemsRef.current ?? []).map((entry) =>
          entry.id === item.id
            ? { ...entry, done: nextDone, completedAt: nextDone ? Date.now() : 0 }
            : entry,
        ),
      );
    },
    [commit],
  );

  const remove = useCallback(
    (id: string) => {
      // 若正编辑该条目则一并关闭弹窗。
      setEditing((current) => (current?.id === id ? null : current));
      commit((itemsRef.current ?? []).filter((entry) => entry.id !== id));
    },
    [commit],
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
    commit(
      (itemsRef.current ?? []).map((entry) =>
        entry.id === id ? { ...entry, title, note, dueAt, remindAt, priority, group } : entry,
      ),
    );
  }, [editing, commit]);

  /** 提交一次重排：清单无变化时静默跳过。 */
  const commitReorder = useCallback(
    (next: TodoItem[] | null) => {
      if (!next) return;
      const signature = (list: TodoItem[]) =>
        list.map((item) => `${item.id}:${item.group}`).join("|");
      if (itemsRef.current && signature(next) === signature(itemsRef.current)) return;
      commit(next);
    },
    [commit],
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
    if (dragIdRef.current) return;
    event.preventDefault();
    const row = (event.currentTarget as HTMLElement).closest<HTMLElement>("[data-todo-id]");
    if (!row) return;
    dragIdRef.current = id;
    dragStartRef.current = {
      px: event.clientX,
      py: event.clientY,
      sy0: window.scrollY,
      el: row,
    };
    pointerRef.current = { x: event.clientX, y: event.clientY };
    lastTestRef.current = null;
    setDragId(id);
  }, []);

  /**
   * 拖拽会话（dnd-kit/Atlassian 惯例）：连续 rAF 循环驱动——指针跟随的
   * transform 直写 DOM（绕过 React 渲染）、视口边缘自动滚屏、命中测试
   * 仅在指针移动或页面滚动后执行。Esc 取消不提交；pointerup 提交重排；
   * pointercancel 视为取消。
   */
  useEffect(() => {
    if (!dragId) return undefined;
    const start = dragStartRef.current;
    const el = start?.el ?? null;
    document.body.classList.add("todo-dragging");

    const onMove = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
    };

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

    const maybeHitTest = () => {
      const pointer = pointerRef.current;
      if (!pointer) return;
      const sy = window.scrollY;
      const last = lastTestRef.current;
      if (last && last.x === pointer.x && last.y === pointer.y && last.sy === sy) return;
      lastTestRef.current = { x: pointer.x, y: pointer.y, sy };
      const hint = hitTest(pointer.x, pointer.y);
      dragHintRef.current = hint;
      setDragHint((current) =>
        current?.group === hint?.group && current?.at === hint?.at ? current : hint,
      );
    };

    const tick = () => {
      const pointer = pointerRef.current;
      const origin = dragStartRef.current;
      if (pointer && origin && el) {
        // 跟随位移补上拖拽期间的页面滚动量，元素始终钉在指针下。
        const dy = pointer.y - origin.py + (window.scrollY - origin.sy0);
        const dx = pointer.x - origin.px;
        el.style.transform = `translate(${dx}px, ${dy}px) rotate(1.5deg)`;
        // 视口上下边缘 72px 内自动滚屏，速度随贴近程度增大。
        const EDGE = 72;
        const MAX_SPEED = 24;
        if (pointer.y < EDGE) {
          window.scrollBy(0, -Math.min(MAX_SPEED, (EDGE - pointer.y) * 0.3));
        } else if (pointer.y > window.innerHeight - EDGE) {
          window.scrollBy(
            0,
            Math.min(MAX_SPEED, (pointer.y - (window.innerHeight - EDGE)) * 0.3),
          );
        }
        maybeHitTest();
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    /** 统一收尾：清理监听/循环/内联样式，按需提交重排。 */
    const finish = (commitDrop: boolean) => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      document.body.classList.remove("todo-dragging");
      const id = dragIdRef.current;
      const hint = dragHintRef.current;
      const pointer = pointerRef.current;
      // 记录松手时刻的视觉偏移，供 FLIP 从指针位置平滑落位（提交）或
      // 归位（取消）。
      lastDropRef.current = {
        id,
        dy: pointer && start ? pointer.y - start.py + (window.scrollY - start.sy0) : 0,
      };
      dragIdRef.current = null;
      dragHintRef.current = null;
      dragStartRef.current = null;
      pointerRef.current = null;
      lastTestRef.current = null;
      if (el) el.style.transform = "";
      setDragId(null);
      setDragHint(null);
      if (commitDrop && id && hint && itemsRef.current) {
        commitReorder(applyReorder(itemsRef.current, id, hint.group, hint.at));
      }
    };

    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
    return () => {
      // 依赖重挂兜底：还原 body 状态与内联样式（正常路径由 finish 收尾）。
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      document.body.classList.remove("todo-dragging");
      if (el) el.style.transform = "";
    };
  }, [dragId, commitReorder]);

  /**
   * FLIP 位移动画：与上一帧布局快照对比，top 变化的行做"反向位移 →
   * 过渡归零"，列表重排、落点提示插行、拖拽取消归位都不再跳变。
   * 拖拽中的行由指针直驱不参与；刚松手的行从指针时刻的视觉位置平滑
   * 落位（dnd-kit 式 drop transition）。reduced-motion 由 base.css 的
   * 全局中和块覆盖。
   */
  useLayoutEffect(() => {
    const snapshot = rectsRef.current;
    const nextSnapshot = new Map<string, number>();
    const drop = lastDropRef.current;
    document.querySelectorAll<HTMLElement>("[data-todo-id]").forEach((row) => {
      const id = row.dataset.todoId ?? "";
      const top = row.getBoundingClientRect().top + window.scrollY;
      const prev = snapshot.get(id);
      nextSnapshot.set(id, top);
      if (prev === undefined) return;
      let delta = prev - top;
      if (drop && drop.id === id) delta += drop.dy;
      if (Math.abs(delta) < 1) return;
      row.style.transition = "none";
      row.style.transform = `translateY(${delta}px)`;
      void row.offsetWidth; // 强制回流，让反向位移先于过渡生效
      row.style.transition = "transform 200ms cubic-bezier(0.2, 0, 0, 1)";
      row.style.transform = "";
      row.addEventListener(
        "transitionend",
        () => {
          row.style.transition = "";
          row.style.transform = "";
        },
        { once: true },
      );
    });
    rectsRef.current = nextSnapshot;
    lastDropRef.current = null;
  });

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
                  role="status"
                  className={
                    sync === "saved"
                      ? "todo-sync todo-sync--saved"
                      : sync === "error"
                        ? "todo-sync todo-sync--error"
                        : "todo-sync"
                  }
                >
                  {sync === "saved" ? (
                    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                      <path
                        d="M2 6.5 5 9.5 10 3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : sync === "error" ? (
                    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                      <path
                        d="M3 3 9 9M9 3 3 9"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                      />
                    </svg>
                  ) : (
                    <span className="todo-sync-dot" aria-hidden="true" />
                  )}
                  {sync === "saved"
                    ? isSignedIn
                      ? t("syncSaved")
                      : t("localOnly")
                    : sync === "error"
                      ? t("syncError")
                      : t("syncSaving")}
                  {sync === "error" ? (
                    <button
                      type="button"
                      className="todo-sync-retry"
                      onClick={() => scheduleFlush(0)}
                    >
                      {t("retry")}
                    </button>
                  ) : null}
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
 * TODO List client. The storage layer is a write-behind queue: in-memory
 * items are the single source of truth, every mutation applies instantly
 * (local-memory speed), and network sync runs in the background — changes
 * persist to a localStorage mirror, get marked dirty, and are pushed with
 * a debounced full-snapshot PUT. Network results surface only through the
 * sync indicator (green check / red error with retry); server responses
 * never overwrite the local list. Cloud loading is SWR: the local mirror
 * renders first, then a background GET reconciles (adopted only when no
 * unpublished local changes exist). Rows support pointer drag-and-drop
 * with a rAF-driven follow (inline transform, edge autoscroll, FLIP move
 * animations, Esc to cancel) plus keyboard reordering. A 401 from the API
 * flips the panel into the expired state.
 */
export default function TodoClient() {
  return <TodoPanel />;
}
