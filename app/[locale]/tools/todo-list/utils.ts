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

/** Shape of a single todo item as returned by /api/todo. */
export interface TodoItem {
  id: string;
  title: string;
  note: string;
  done: boolean;
  createdAt: number;
  /** Completion timestamp; 0 for pending items (or unknown legacy data). */
  completedAt: number;
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
