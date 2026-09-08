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
}

/** Coerce a raw entry into a TodoItem, or null when unusable. */
export function normalizeItem(entry: unknown): TodoItem | null {
  if (typeof entry !== "object" || entry === null) return null;
  const raw = entry as Record<string, unknown>;
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;
  if (typeof raw.title !== "string" || raw.title.trim().length === 0) return null;
  const createdAt = Number(raw.createdAt);
  return {
    id: raw.id,
    title: raw.title,
    note:
      typeof raw.note === "string" ? raw.note.trim().slice(0, MAX_NOTE_LEN) : "",
    done: raw.done === true,
    createdAt: Number.isFinite(createdAt) ? createdAt : 0,
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

/** Aggregate counters for the status footer. */
export function statsSummary(items: TodoItem[]): {
  total: number;
  done: number;
  pending: number;
} {
  const total = items.length;
  const done = items.filter((item) => item.done).length;
  return { total, done, pending: total - done };
}
