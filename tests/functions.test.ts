import { describe, expect, it } from "vitest";
import { countOnline, sessionKey } from "../functions/api/presence.js";
import { buildStarsPayload, isFresh } from "../functions/api/github/stars.js";
import { extractClientIp } from "../functions/api/echo.js";

/**
 * Unit coverage for the EdgeOne edge functions in functions/. Each module is
 * self-contained (no cross-imports) and exports its pure logic for testing;
 * the deployed handlers (onRequest*) stay thin wrappers around it. Changing
 * any exported signature here requires updating the corresponding assertions.
 */

const HOUR = 3_600_000;

// ---------------------------------------------------------------------------
// functions/api/presence.js
// ---------------------------------------------------------------------------

/** In-memory KV stub matching the official EdgeOne KV surface used in prod. */
function fakeKv(entries: Array<[string, string]> = []) {
  const store = new Map(entries);
  return {
    store,
    async list({ prefix, limit }: { prefix?: string; limit?: number } = {}) {
      const keys = [...store.keys()]
        .filter((key) => key.startsWith(prefix ?? ""))
        .slice(0, limit ?? 256)
        .map((key) => ({ name: key })); // official ListResult shape: { name }
      return { complete: true, cursor: "", keys };
    },
    async get(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    async put(key: string, value: string) {
      store.set(key, String(value));
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

describe("presence sessionKey", () => {
  it("normalizes ids to the KV-safe charset (letters/digits/underscore)", () => {
    expect(sessionKey("abc-DEF.123")).toBe("presence_abc_DEF_123");
    expect(sessionKey("a/b\\c:d")).toBe("presence_a_b_c_d");
  });

  it("caps the normalized id at 64 chars", () => {
    const key = sessionKey("x".repeat(100));
    expect(key.startsWith("presence_")).toBe(true);
    expect(key.length).toBe("presence_".length + 64);
  });
});

describe("presence countOnline", () => {
  const NOW = 1_000_000_000;

  it("counts only sessions that heartbeated within the TTL", async () => {
    const kv = fakeKv([
      ["presence_fresh", String(NOW - 10_000)],
      ["presence_edge", String(NOW - 44_999)], // 1ms inside the 45s window
      ["presence_stale", String(NOW - 46_000)],
      ["presence_junk", "not-a-number"],
    ]);
    expect(await countOnline(kv, { now: NOW })).toBe(2);
  });

  it("sweep lazily deletes expired and malformed entries", async () => {
    const kv = fakeKv([
      ["presence_fresh", String(NOW - 10_000)],
      ["presence_stale", String(NOW - 90_000)],
      ["presence_junk", "oops"],
    ]);
    expect(await countOnline(kv, { now: NOW, sweep: true })).toBe(1);
    expect(kv.store.has("presence_stale")).toBe(false);
    expect(kv.store.has("presence_junk")).toBe(false);
    expect(kv.store.has("presence_fresh")).toBe(true);
  });

  it("accepts list entries as strings or { name } objects", async () => {
    const store = new Map([
      ["presence_a", String(NOW)],
      ["presence_b", String(NOW)],
    ]);
    const kv = {
      store,
      list: async () => ({
        complete: true,
        cursor: "",
        keys: ["presence_a", { name: "presence_b" }] as Array<
          string | { name: string }
        >,
      }),
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => void store.set(key, value),
      delete: async (key: string) => void store.delete(key),
    };
    expect(await countOnline(kv, { now: NOW })).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// functions/api/github/stars.js
// ---------------------------------------------------------------------------

describe("stars isFresh", () => {
  const base = 1_700_000_000_000;

  it("fresh within one hour", () => {
    expect(isFresh({ fetchedAt: base }, base + HOUR - 1)).toBe(true);
  });

  it("stale at exactly one hour", () => {
    expect(isFresh({ fetchedAt: base }, base + HOUR)).toBe(false);
  });

  it("malformed records are never fresh", () => {
    expect(isFresh(null, base)).toBe(false);
    expect(isFresh(undefined, base)).toBe(false);
    expect(isFresh({}, base)).toBe(false);
    expect(isFresh({ fetchedAt: "x" }, base)).toBe(false);
  });
});

describe("buildStarsPayload", () => {
  const repos = [
    { name: "b", stargazers_count: 10, html_url: "https://github.com/x/b" },
    { name: "a", stargazers_count: 30, html_url: "https://github.com/x/a" },
    { name: "c", stargazers_count: 20, html_url: "https://github.com/x/c" },
    { name: "d", stargazers_count: 5, html_url: "https://github.com/x/d" },
    { stargazers_count: 99 }, // malformed: no name
  ];

  it("sums stars and counts repos, including malformed entries", () => {
    const payload = buildStarsPayload(repos);
    expect(payload.totalStars).toBe(99 + 30 + 20 + 10 + 5);
    expect(payload.publicRepoCount).toBe(5);
  });

  it("ranks top 3 by stars, skipping malformed entries", () => {
    const payload = buildStarsPayload(repos);
    expect(payload.top.map((repo: { name: string }) => repo.name)).toEqual(["a", "c", "b"]);
  });
});

// ---------------------------------------------------------------------------
// functions/api/echo.js
// ---------------------------------------------------------------------------

describe("extractClientIp", () => {
  it("follows the EdgeOne-first header priority", () => {
    expect(
      extractClientIp({
        "x-forwarded-for": "1.1.1.1",
        "eo-connecting-ip": "2.2.2.2",
        "x-real-ip": "3.3.3.3",
      }),
    ).toEqual({ ip: "2.2.2.2", source: "eo-connecting-ip" });
  });

  it("falls back to the first x-forwarded-for hop", () => {
    expect(extractClientIp({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" })).toEqual({
      ip: "1.1.1.1",
      source: "x-forwarded-for",
    });
  });

  it("ignores unusable values", () => {
    expect(extractClientIp({ "x-real-ip": "unknown" })).toBeNull();
    expect(extractClientIp({})).toBeNull();
  });
});
