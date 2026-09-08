/**
 * Client-side guards for the /api/todo payload. The edge function is the
 * source of truth; these helpers only normalize defensive reads so a
 * malformed payload can never crash the UI.
 */

/** Shape of a single todo item as returned by /api/todo. */
export interface TodoItem {
  id: string;
  title: string;
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
