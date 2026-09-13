/**
 * Client-side guards for the /api/todo payload (and for the signed-out
 * localStorage mirror of the same shape). The edge function is the source
 * of truth; these helpers only normalize defensive reads so a malformed
 * payload can never crash the UI.
 */

/** List size cap, mirroring the edge function's MAX_ITEMS. */
export const MAX_ITEMS = 200;

/** Details (note) length cap, mirroring the edge function's MAX_NOTE_LEN. */
export const MAX_NOTE_LEN = 2000;

/** Group name length cap, mirroring the edge function's MAX_GROUP_LEN. */
export const MAX_GROUP_LEN = 40;

/** Highest priority tier (0 none / 1 low / 2 medium / 3 high). */
export const MAX_PRIORITY = 3;

/** Coerce a timestamp-like value to a positive ms number, else 0. */
function cleanStamp(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Clamp a priority-like value into the 0..MAX_PRIORITY integer range. */
function cleanPriority(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(MAX_PRIORITY, Math.max(0, n)) : 0;
}

/** Trim and length-cap a group name; non-strings collapse to the default. */
function cleanGroup(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_GROUP_LEN) : "";
}

/** Shape of a single todo item as returned by /api/todo. */
export interface TodoItem {
  id: string;
  title: string;
  note: string;
  done: boolean;
  createdAt: number;
  /** Completion timestamp; 0 for pending items (or unknown legacy data). */
  completedAt: number;
  /** Due timestamp (ms); 0 = not set. */
  dueAt: number;
  /** Reminder timestamp (ms); 0 = not set. */
  remindAt: number;
  /** Priority tier 0-3; 0 = none. */
  priority: number;
  /** Group name; "" = default group. Array order is the display order. */
  group: string;
}

/** Coerce a raw entry into a TodoItem, or null when unusable. */
export function normalizeItem(entry: unknown): TodoItem | null {
  if (typeof entry !== "object" || entry === null) return null;
  const raw = entry as Record<string, unknown>;
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;
  if (typeof raw.title !== "string" || raw.title.trim().length === 0) return null;
  const createdAt = Number(raw.createdAt);
  const completedAt = Number(raw.completedAt);
  const done = raw.done === true;
  return {
    id: raw.id,
    title: raw.title,
    note:
      typeof raw.note === "string" ? raw.note.trim().slice(0, MAX_NOTE_LEN) : "",
    done,
    createdAt: Number.isFinite(createdAt) ? createdAt : 0,
    // Done items without a completion timestamp fall back to createdAt so
    // legacy entries still land in the trend chart (best-effort approximation).
    completedAt: done
      ? Number.isFinite(completedAt) && completedAt > 0
        ? completedAt
        : createdAt > 0
          ? createdAt
          : 0
      : 0,
    dueAt: cleanStamp(raw.dueAt),
    remindAt: cleanStamp(raw.remindAt),
    priority: cleanPriority(raw.priority),
    group: cleanGroup(raw.group),
  };
}

/**
 * Validate and normalize an /api/todo response body ({ items }). Returns
 * null when the payload is structurally unusable (caller keeps the
 * previous state); unusable entries are dropped defensively.
 */
export function normalizeItems(data: unknown): TodoItem[] | null {
  if (typeof data !== "object" || data === null) return null;
  const raw = data as Record<string, unknown>;
  if (!Array.isArray(raw.items)) return null;
  return raw.items
    .map((entry) => normalizeItem(entry))
    .filter((item): item is TodoItem => item !== null);
}

/** Whether an item's due date has passed while still pending. */
export function isOverdue(item: TodoItem, now: number): boolean {
  if (item.done || item.dueAt <= 0) return false;
  // The due date covers the whole end day (23:59:59.999 local time).
  const endOfDay = startOfDay(item.dueAt) + DAY_MS - 1;
  return endOfDay < now;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Format a ms timestamp as a local yyyy-mm-dd value ("" when unset). */
export function formatDateValue(ms: number): string {
  if (ms <= 0) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Format a ms timestamp as a local datetime-local value ("" when unset). */
export function formatDateTimeValue(ms: number): string {
  if (ms <= 0) return "";
  const d = new Date(ms);
  return `${formatDateValue(ms)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Parse a yyyy-mm-dd value into a local-midnight timestamp (0 otherwise). */
export function parseDateValue(value: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return 0;
  const ms = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/** Parse a datetime-local value into a timestamp (0 otherwise). */
export function parseDateTimeValue(value: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return 0;
  const ms = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
  ).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/** A rendered group: the default group keeps the "" name and sorts first. */
export interface GroupSection {
  name: string;
  items: TodoItem[];
}

/**
 * Split items into group sections for rendering. The default group ("")
 * always comes first; named groups follow in first-appearance order so
 * permutation is stable across renders (array order = display order).
 */
export function groupSections(items: TodoItem[]): GroupSection[] {
  const sections: GroupSection[] = [{ name: "", items: [] }];
  const index = new Map<string, number>([["", 0]]);
  for (const item of items) {
    let at = index.get(item.group);
    if (at === undefined) {
      at = sections.length;
      index.set(item.group, at);
      sections.push({ name: item.group, items: [] });
    }
    sections[at].items.push(item);
  }
  return sections;
}

/** Aggregate counters for the stats tab. */
export function statsSummary(items: TodoItem[]): {
  total: number;
  done: number;
  pending: number;
} {
  const total = items.length;
  const done = items.filter((item) => item.done).length;
  return { total, done, pending: total - done };
}

/** Per-day counters for the 7-day trend chart. */
export interface DayBucket {
  added: number;
  completed: number;
}

const DAY_MS = 86_400_000;

function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Bucket items into the 7 calendar days ending today (local time):
 * index 0 is six days ago, index 6 is today. "added" counts createdAt,
 * "completed" counts completedAt (done items only, 0/unknown skipped).
 */
export function trend7Days(items: TodoItem[], now: number): DayBucket[] {
  const days: DayBucket[] = Array.from({ length: 7 }, () => ({ added: 0, completed: 0 }));
  const weekStart = startOfDay(now) - 6 * DAY_MS;
  for (const item of items) {
    if (item.createdAt > 0) {
      const addIndex = Math.floor((startOfDay(item.createdAt) - weekStart) / DAY_MS);
      if (addIndex >= 0 && addIndex < 7) days[addIndex].added += 1;
    }
    if (item.done && item.completedAt > 0) {
      const doneIndex = Math.floor((startOfDay(item.completedAt) - weekStart) / DAY_MS);
      if (doneIndex >= 0 && doneIndex < 7) days[doneIndex].completed += 1;
    }
  }
  return days;
}

/**
 * Move `dragId` into `targetGroup` at position `indexInGroup` and return the
 * new flat array (never mutating the input; null when dragId is unknown).
 *
 * `indexInGroup` is measured against the rendered list INCLUDING the dragged
 * item (i.e. the slot index under the pointer while it is still visible).
 * When moving down inside the same group, removing the item first shifts the
 * target slot, so the index is corrected internally.
 */
export function applyReorder(
  items: TodoItem[],
  dragId: string,
  targetGroup: string,
  indexInGroup: number,
): TodoItem[] | null {
  const dragIndex = items.findIndex((item) => item.id === dragId);
  if (dragIndex < 0) return null;
  const dragging = items[dragIndex];
  const rest = items.filter((_, i) => i !== dragIndex);
  const sections = groupSections(rest);

  const groupAt = sections.findIndex((section) => section.name === targetGroup);
  if (groupAt < 0) return null;
  // Clamp within the WITH-dragged list domain (the dragged item itself still
  // occupies a slot in its own group), so bottom-of-group drops survive the
  // -1 correction below.
  const lenWith =
    sections[groupAt].items.length + (dragging.group === targetGroup ? 1 : 0);
  const at = Math.max(0, Math.min(indexInGroup, lenWith));
  const sameGroupDown = dragging.group === targetGroup && dragIndex < indexInGroup;

  let flatIndex = 0;
  for (let i = 0; i < groupAt; i += 1) flatIndex += sections[i].items.length;
  flatIndex += sameGroupDown ? at - 1 : at;

  const next = [...rest];
  next.splice(flatIndex, 0, { ...dragging, group: targetGroup });
  return next;
}

// ---------------------------------------------------------------------------
// localStorage mirror + draft helpers (extracted from TodoClient.tsx so the
// parsing logic stays unit-testable; TodoClient keeps thin storage wrappers)
// ---------------------------------------------------------------------------

/** Guest-mirror localStorage key (read through TodoClient's wrapper). */
export const LOCAL_KEY = "lucky-todo-local-v1";

/** Payload for creating a new item (title required; the rest are optional). */
export interface TodoDraft {
  title: string;
  note: string;
  dueAt: number;
  remindAt: number;
  priority: number;
  group: string;
}

/** Cloud mirror key: isolated per account (uid sanitized into the suffix). */
export function cloudMirrorKey(uid: string): string {
  return `lucky-todo-cloud-v1-${uid.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

/**
 * Parse the guest mirror payload: accepts both historical formats, the
 * { items } wrapper and the bare array. Unusable input degrades to [].
 */
export function parseLocalItems(raw: string | null): TodoItem[] {
  if (!raw) return [];
  try {
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

/**
 * Parse a cloud mirror payload ({ items, dirty } wrapper); null when
 * missing/unusable. dirty means local changes have not been uploaded yet,
 * so offline changes survive a page close and get re-flushed later.
 */
export function parseCloudMirror(
  raw: string | null,
): { items: TodoItem[]; dirty: boolean } | null {
  if (!raw) return null;
  try {
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

/**
 * Build a new pending item. Same id scheme as the edge function's
 * makeItemId: base36 timestamp + short random segment; `now` is injectable
 * for deterministic tests.
 */
export function makeLocalItem(draft: TodoDraft, now: number = Date.now()): TodoItem {
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

/** Priority → i18n key (0 shows no badge, so there is no key for it). */
export function priorityKey(
  priority: number,
): "priorityLow" | "priorityMedium" | "priorityHigh" {
  if (priority >= 3) return "priorityHigh";
  if (priority === 2) return "priorityMedium";
  return "priorityLow";
}
// ---------------------------------------------------------------------------
// List toolbar: search / status filter / sort / clear-completed
// ---------------------------------------------------------------------------

export type TodoStatusFilter = "all" | "active" | "done" | "overdue";
export type TodoSortMode = "manual" | "due" | "priority" | "created";

/**
 * Case-insensitive query across title + note, plus a status facet.
 `now` is injectable so overdue filtering is deterministic in tests.
 */
export function filterTodoItems(
  items: TodoItem[],
  {
    query = "",
    status = "all",
    now = Date.now(),
  }: { query?: string; status?: TodoStatusFilter; now?: number } = {},
): TodoItem[] {
  const q = query.trim().toLowerCase();
  return items.filter((item) => {
    if (q) {
      const haystack = (item.title + "\n" + item.note).toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (status === "active" && item.done) return false;
    if (status === "done" && !item.done) return false;
    if (status === "overdue" && (item.done || !isOverdue(item, now))) return false;
    return true;
  });
}

/**
 * Sort for display. `manual` is the identity order (array order = user
 * curated order, the drag-and-drop fact source); the other modes return a
 * stable sorted copy and never mutate the input.
 */
export function sortTodoItems(items: TodoItem[], mode: TodoSortMode): TodoItem[] {
  if (mode === "manual") return items;
  const next = [...items];
  switch (mode) {
    case "due": {
      // Dated items first (ascending); undated trail in stable order.
      return next.sort((a, b) => {
        const av = a.dueAt > 0 ? a.dueAt : Number.POSITIVE_INFINITY;
        const bv = b.dueAt > 0 ? b.dueAt : Number.POSITIVE_INFINITY;
        return av - bv;
      });
    }
    case "priority":
      return next.sort((a, b) => b.priority - a.priority);
    case "created":
      return next.sort((a, b) => b.createdAt - a.createdAt);
    default:
      return next;
  }
}

/** Drop every completed item (toolbar "clear done" action). */
export function removeDone(items: TodoItem[]): TodoItem[] {
  return items.filter((item) => !item.done);
}
