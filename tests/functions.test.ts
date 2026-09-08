import { describe, expect, it } from "vitest";
import {
  applyTap,
  counterKey,
  countTotals,
  isTokenFresh,
  parseTokenPayload,
  readSessionToken,
  sumCounts,
  verifySessionToken,
} from "../functions/api/counter.js";
import { countOnline, sessionKey } from "../functions/api/presence.js";
import { extractClientIp } from "../functions/api/echo.js";

/**
 * Unit coverage for the EdgeOne edge functions in functions/. Each module is
 * self-contained (no cross-imports) and exports its pure logic for testing;
 * the deployed handlers (onRequest*) stay thin wrappers around it. Changing
 * any exported signature here requires updating the corresponding assertions.
 */

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
// functions/api/counter.js
// ---------------------------------------------------------------------------

describe("counter counterKey", () => {
  it("normalizes user ids to the KV-safe charset (letters/digits/underscore)", () => {
    expect(counterKey("user_abc-123")).toBe("counter_user_user_abc_123");
    expect(counterKey("a/b\\c:d")).toBe("counter_user_a_b_c_d");
  });

  it("caps the normalized id at 64 chars", () => {
    const key = counterKey("x".repeat(100));
    expect(key.startsWith("counter_user_")).toBe(true);
    expect(key.length).toBe("counter_user_".length + 64);
  });
});

describe("counter sumCounts / countTotals", () => {
  it("sums valid counts and counts only usable entries as users", () => {
    expect(sumCounts(["3", "5", "0"])).toEqual({ total: 8, users: 3 });
    expect(sumCounts(["oops", "-2", null, "4"])).toEqual({ total: 4, users: 1 });
    expect(sumCounts([])).toEqual({ total: 0, users: 0 });
    expect(sumCounts(undefined)).toEqual({ total: 0, users: 0 });
  });

  it("countTotals reads every per-user key via list + batched get", async () => {
    const kv = fakeKv([
      ["counter_user_alice", "3"],
      ["counter_user_bob", "5"],
      ["presence_fresh", "123"], // other namespaces must not leak in
    ]);
    expect(await countTotals(kv)).toEqual({ total: 8, users: 2 });
  });
});

describe("counter applyTap", () => {
  it("increments from zero for a first-time user", async () => {
    const kv = fakeKv();
    expect(await applyTap(kv, "user_a")).toBe(1);
    expect(kv.store.get("counter_user_user_a")).toBe("1");
  });

  it("increments existing counts and repairs corrupted values", async () => {
    const kv = fakeKv([
      ["counter_user_user_a", "9"],
      ["counter_user_user_b", "not-a-number"],
    ]);
    expect(await applyTap(kv, "user_a")).toBe(10);
    expect(await applyTap(kv, "user_b")).toBe(1); // corrupted -> restart at 1
    expect(await applyTap(kv, "user_a")).toBe(11);
  });
});

describe("counter session token helpers", () => {
  const encoder = new TextEncoder();

  function b64urlEncode(bytes: Uint8Array): string {
    let binary = "";
    bytes.forEach((b) => (binary += String.fromCharCode(b)));
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function b64urlJson(value: unknown): string {
    return b64urlEncode(encoder.encode(JSON.stringify(value)));
  }

  function fakeRequest(cookie: string | undefined) {
    return { headers: new Headers(cookie === undefined ? {} : { cookie }) };
  }

  async function makeKey(kid: string) {
    const pair = (await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const jwk = {
      ...(await crypto.subtle.exportKey("jwk", pair.publicKey)),
      kid,
    };
    return { privateKey: pair.privateKey, jwk };
  }

  async function buildToken(
    privateKey: CryptoKey,
    header: Record<string, unknown>,
    payload: Record<string, unknown>,
  ) {
    const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      encoder.encode(signingInput),
    );
    return `${signingInput}.${b64urlEncode(new Uint8Array(signature))}`;
  }

  it("readSessionToken extracts __session from the cookie header", () => {
    expect(readSessionToken(fakeRequest("__session=jwt.value.sig"))).toBe("jwt.value.sig");
    expect(readSessionToken(fakeRequest("other=1; __session=abc; x=2"))).toBe("abc");
    expect(readSessionToken(fakeRequest("other=1"))).toBeNull();
    expect(readSessionToken(fakeRequest(undefined))).toBeNull();
    expect(readSessionToken(null)).toBeNull();
  });

  it("parseTokenPayload splits a well-formed JWT and rejects malformed ones", () => {
    const token = `${b64urlJson({ alg: "ES256", kid: "k" })}.${b64urlJson({
      sub: "u1",
      exp: 2_000_000_000,
    })}.c2ln`;
    const parsed = parseTokenPayload(token);
    expect(parsed?.header).toEqual({ alg: "ES256", kid: "k" });
    expect(parsed?.payload).toEqual({ sub: "u1", exp: 2_000_000_000 });

    expect(parseTokenPayload("a.b")).toBeNull(); // missing signature
    expect(parseTokenPayload("a..c2ln")).toBeNull(); // empty payload segment
    expect(parseTokenPayload("!!!.!!!.!!!")).toBeNull(); // not base64
    expect(parseTokenPayload(42 as unknown as string)).toBeNull();
  });

  it("isTokenFresh checks exp (seconds) against now (ms)", () => {
    expect(isTokenFresh({ exp: 2_000_000_000 }, 1_000_000_000_000)).toBe(true);
    expect(isTokenFresh({ exp: 1_000_000_000 }, 1_000_000_000_000)).toBe(false);
    expect(isTokenFresh({}, 1_000_000_000_000)).toBe(false);
  });

  it("verifySessionToken validates signature, alg, kid and exp", async () => {
    const { privateKey, jwk } = await makeKey("test-key");
    const exp = Math.floor(Date.now() / 1000) + 600;
    const token = await buildToken(
      privateKey,
      { alg: "ES256", kid: "test-key", typ: "JWT" },
      { sub: "user_abc", iss: "https://test.example.com", exp },
    );

    const payload = await verifySessionToken(token, { jwks: [jwk] });
    expect(payload?.sub).toBe("user_abc");
  });

  it("verifySessionToken rejects tampered, expired, wrong-alg and unknown-kid tokens", async () => {
    const { privateKey, jwk } = await makeKey("test-key");
    const now = Date.now();
    const header = { alg: "ES256", kid: "test-key", typ: "JWT" };

    const expired = await buildToken(privateKey, header, {
      sub: "u",
      exp: Math.floor(now / 1000) - 10,
    });
    expect(await verifySessionToken(expired, { jwks: [jwk], now })).toBeNull();

    const wrongAlg = await buildToken(privateKey, { ...header, alg: "none" }, {
      sub: "u",
      exp: Math.floor(now / 1000) + 600,
    });
    expect(await verifySessionToken(wrongAlg, { jwks: [jwk] })).toBeNull();

    const unknownKid = await buildToken(privateKey, { ...header, kid: "other" }, {
      sub: "u",
      exp: Math.floor(now / 1000) + 600,
    });
    expect(await verifySessionToken(unknownKid, { jwks: [jwk] })).toBeNull();

    const valid = await buildToken(privateKey, header, {
      sub: "u",
      exp: Math.floor(now / 1000) + 600,
    });
    const tampered = `${valid.slice(0, -4)}AAAA`;
    await expect(verifySessionToken(tampered, { jwks: [jwk] })).resolves.toBeNull();
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
