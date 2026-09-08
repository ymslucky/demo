/**
 * Client-side guards for the /api/counter payload. The edge function is the
 * source of truth; these helpers only normalize defensive reads so a
 * malformed payload can never crash the UI.
 */

/** Shape returned by both GET and POST /api/counter. */
export interface CounterSnapshot {
  total: number;
  users: number;
  mine: number;
}

/** Coerce an API count into a non-negative integer, falling back to 0. */
export function normalizeCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/**
 * Validate and normalize an /api/counter response body. Returns null when
 * the payload is structurally unusable (caller keeps the previous state).
 */
export function normalizeSnapshot(data: unknown): CounterSnapshot | null {
  if (typeof data !== "object" || data === null) return null;
  const raw = data as Record<string, unknown>;
  if (!("total" in raw) || !("mine" in raw)) return null;
  return {
    total: normalizeCount(raw.total),
    users: normalizeCount(raw.users),
    mine: normalizeCount(raw.mine),
  };
}
