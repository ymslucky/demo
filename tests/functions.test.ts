import { describe, expect, it } from "vitest";
import {
  addTodo,
  isAllowedAzp,
  isTokenFresh,
  makeItemId,
  normalizeItems,
  parseTokenPayload,
  readSessionToken,
  removeTodo,
  siteApex,
  todoKey,
  updateTodo,
  verifyRs256,
  verifySessionToken,
  verifyTokenDetailed,
} from "../functions/api/todo.js";
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
        .map((key) => ({ key })); // official ListResult shape: ListKey { key }
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

  it("accepts list entries as strings or { key } objects", async () => {
    const store = new Map([
      ["presence_a", String(NOW)],
      ["presence_b", String(NOW)],
    ]);
    const kv = {
      store,
      list: async () => ({
        complete: true,
        cursor: "",
        keys: ["presence_a", { key: "presence_b" }] as Array<
          string | { key: string }
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
// functions/api/todo.js
// ---------------------------------------------------------------------------

describe("todo todoKey", () => {
  it("normalizes user ids to the KV-safe charset (letters/digits/underscore)", () => {
    expect(todoKey("user_abc-123")).toBe("todo_user_user_abc_123");
    expect(todoKey("a/b\\c:d")).toBe("todo_user_a_b_c_d");
  });

  it("caps the normalized id at 64 chars", () => {
    const key = todoKey("x".repeat(100));
    expect(key.startsWith("todo_user_")).toBe(true);
    expect(key.length).toBe("todo_user_".length + 64);
  });
});

describe("todo makeItemId", () => {
  it("prefixes ids with the base36 timestamp", () => {
    const now = 1_700_000_000_000;
    expect(makeItemId(now).startsWith(now.toString(36))).toBe(true);
  });

  it("avoids collisions within the same millisecond", () => {
    expect(makeItemId(123)).not.toBe(makeItemId(123));
  });
});

describe("todo normalizeItems", () => {
  it("parses the KV JSON string and drops unusable entries", () => {
    expect(
      normalizeItems(
        JSON.stringify([
          { id: "a", title: "  milk  ", done: true, createdAt: 123 },
          {},
          { id: "b" },
          "junk",
          null,
          { id: "c", title: "x", done: "yes", createdAt: "oops" },
        ]),
      ),
    ).toEqual([
      {
        id: "a",
        title: "milk",
        note: "",
        done: true,
        createdAt: 123,
        completedAt: 123, // done but no completedAt -> falls back to createdAt
      },
      { id: "c", title: "x", note: "", done: false, createdAt: 0, completedAt: 0 },
    ]);
  });

  it("accepts an already-parsed array and caps the list size", () => {
    const raw = Array.from({ length: 250 }, (_, i) => ({
      id: `k${i}`,
      title: `t${i}`,
    }));
    const items = normalizeItems(raw);
    expect(items).toHaveLength(200);
    expect(items[0]).toMatchObject({ id: "k0" });
  });

  it("degrades any malformed payload to an empty list", () => {
    expect(normalizeItems("not json")).toEqual([]);
    expect(normalizeItems({ items: [] })).toEqual([]);
    expect(normalizeItems(null)).toEqual([]);
  });
});

describe("todo addTodo / updateTodo / removeTodo", () => {
  it("addTodo prepends a trimmed item and caps the list size", () => {
    const full = Array.from({ length: 200 }, (_, i) => ({
      id: `k${i}`,
      title: `t${i}`,
      done: false,
      createdAt: i,
    }));
    const added = addTodo(full, "  hello  ", { id: "new", createdAt: 42, note: "  n  " })!;
    expect(added).toHaveLength(200);
    expect(added[0]).toEqual({
      id: "new",
      title: "hello",
      note: "n",
      done: false,
      createdAt: 42,
      completedAt: 0,
    });
    expect(added[1]).toMatchObject({ id: "k0" });
    expect(addTodo([], "   ")).toBeNull(); // blank titles are rejected
  });

  it("updateTodo patches done/title/note immutably and rejects ghost ids", () => {
    const items = [
      { id: "a", title: "first", note: "", done: false, createdAt: 1 },
      { id: "b", title: "second", note: "", done: false, createdAt: 2 },
    ];
    const patched = updateTodo(
      items,
      "a",
      { done: true, title: "  renamed  " },
      999,
    );
    expect(patched[0]).toEqual({
      id: "a",
      title: "renamed",
      note: "",
      done: true,
      createdAt: 1,
      completedAt: 999,
    });
    expect(items[0].done).toBe(false); // original array untouched

    expect(updateTodo(items, "ghost", { done: true })).toBeNull();
    // Non-boolean done / blank title patches are ignored.
    expect(updateTodo(items, "a", { done: "yes" })[0].done).toBe(false);
    expect(updateTodo(items, "a", { title: "   " })[0].title).toBe("first");
  });

  it("updateTodo trims note, allows clearing with an empty string", () => {
    const items = [{ id: "a", title: "first", note: "old", done: false, createdAt: 1 }];
    expect(updateTodo(items, "a", { note: "  new  " })[0].note).toBe("new");
    expect(updateTodo(items, "a", { note: "   " })[0].note).toBe("");
    expect(updateTodo(items, "a", { note: "x".repeat(3000) })[0].note).toHaveLength(2000);
    expect(items[0].note).toBe("old"); // original array untouched
  });

  it("updateTodo couples completedAt to done toggles only", () => {
    const base = { id: "a", title: "first", note: "", createdAt: 1 };
    const items = [
      { ...base, done: false, completedAt: 0 },
      { ...base, done: true, completedAt: 55, id: "b", title: "second" },
    ];
    // Marking done stamps completedAt with the injected clock.
    expect(updateTodo(items, "a", { done: true }, 888)[0]).toMatchObject({
      done: true,
      completedAt: 888,
    });
    // Un-checking clears it.
    expect(updateTodo(items, "b", { done: false })!.find((i: { id: string }) => i.id === "b")).toMatchObject({
      done: false,
      completedAt: 0,
    });
    // Title/note edits leave an existing completion stamp untouched.
    expect(updateTodo(items, "b", { title: "renamed" }, 888)!.find((i: { id: string }) => i.id === "b")).toMatchObject({
      done: true,
      completedAt: 55,
    });
  });

  it("removeTodo deletes by id and reports misses as null", () => {
    const items = [
      { id: "a", title: "first", note: "", done: false, createdAt: 1 },
      { id: "b", title: "second", note: "", done: false, createdAt: 2 },
    ];
    expect(removeTodo(items, "a")).toEqual([
      { id: "b", title: "second", note: "", done: false, createdAt: 2 },
    ]);
    expect(removeTodo(items, "ghost")).toBeNull();
    expect(items).toHaveLength(2); // original array untouched
  });
});

describe("todo site apex derivation", () => {
  it("siteApex strips protocol / path / www and rejects empties", () => {
    expect(siteApex("rdom.cn")).toBe("rdom.cn");
    expect(siteApex("https://www.rdom.cn/zh/tools/")).toBe("rdom.cn");
    expect(siteApex("  HTTP://RDOM.CN  ")).toBe("rdom.cn");
    expect(siteApex(undefined)).toBeNull();
    expect(siteApex("   ")).toBeNull();
    expect(siteApex("https://")).toBeNull();
  });
});

describe("todo azp same-party check", () => {
  it("isAllowedAzp accepts the apex and any subdomain, rejects lookalikes", () => {
    expect(isAllowedAzp("https://rdom.cn", "rdom.cn")).toBe(true);
    expect(isAllowedAzp("https://www.rdom.cn", "rdom.cn")).toBe(true);
    expect(isAllowedAzp("https://app.rdom.cn/zh/", "rdom.cn")).toBe(true);
    expect(isAllowedAzp("https://APP.RDOM.CN", "rdom.cn")).toBe(true);
    expect(isAllowedAzp("https://rdom.cn.evil.com", "rdom.cn")).toBe(false);
    expect(isAllowedAzp("https://notrdom.cn", "rdom.cn")).toBe(false);
    expect(isAllowedAzp(undefined, "rdom.cn")).toBe(false);
  });
});

describe("todo session token helpers", () => {
  const encoder = new TextEncoder();
  // The verifier pins iss/azp allowlists (Clerk manual-verification checklist);
  // tests inject these values so no real network or production URLs are used.
  const ISS = "https://clerk.test.example.com";
  const AZP = "https://app.test.example.com";

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

  async function makeRsaKey(kid: string) {
    const pair = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
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
    // Sign with the algorithm named in the header (ES256 is the default).
    const signParams =
      header.alg === "RS256"
        ? { name: "RSASSA-PKCS1-v1_5" }
        : { name: "ECDSA", hash: "SHA-256" };
    const signature = await crypto.subtle.sign(
      signParams,
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

  it("isTokenFresh checks exp/nbf (seconds) against now (ms) with clerk skew tolerance", () => {
    expect(isTokenFresh({ exp: 2_000_000_000 }, 1_000_000_000_000)).toBe(true);
    // 5s tolerance: an exp within CLOCK_SKEW_S is still accepted.
    expect(isTokenFresh({ exp: 1_000_000_003 }, 1_000_000_000_000)).toBe(true);
    expect(isTokenFresh({ exp: 999_999_990 }, 1_000_000_000_000)).toBe(false);
    expect(isTokenFresh({}, 1_000_000_000_000)).toBe(false);

    // nbf inside the tolerance window is accepted, beyond it is rejected.
    expect(
      isTokenFresh({ exp: 2_000_000_000, nbf: 1_000_000_003 }, 1_000_000_000_000),
    ).toBe(true);
    expect(
      isTokenFresh({ exp: 2_000_000_000, nbf: 1_000_000_100 }, 1_000_000_000_000),
    ).toBe(false);
  });

  it("verifySessionToken validates signature, alg, kid, iss and exp", async () => {
    const { privateKey, jwk } = await makeKey("test-key");
    const exp = Math.floor(Date.now() / 1000) + 600;
    const token = await buildToken(
      privateKey,
      { alg: "ES256", kid: "test-key", typ: "JWT" },
      { sub: "user_abc", iss: ISS, azp: AZP, exp },
    );

    const payload = await verifySessionToken(token, {
      jwks: [jwk],
      allowedIssuers: [ISS],
      azpApex: "test.example.com",
    });
    expect(payload?.sub).toBe("user_abc");
  });

  it("verifySessionToken rejects tampered, expired, wrong-alg and unknown-kid tokens", async () => {
    const { privateKey, jwk } = await makeKey("test-key");
    const now = Date.now();
    const header = { alg: "ES256", kid: "test-key", typ: "JWT" };

    const expired = await buildToken(privateKey, header, {
      sub: "u",
      iss: ISS,
      exp: Math.floor(now / 1000) - 10,
    });
    expect(
      await verifySessionToken(expired, { jwks: [jwk], now, allowedIssuers: [ISS] }),
    ).toBeNull();

    const wrongAlg = await buildToken(privateKey, { ...header, alg: "none" }, {
      sub: "u",
      iss: ISS,
      exp: Math.floor(now / 1000) + 600,
    });
    expect(
      await verifySessionToken(wrongAlg, { jwks: [jwk], allowedIssuers: [ISS] }),
    ).toBeNull();

    const unknownKid = await buildToken(privateKey, { ...header, kid: "other" }, {
      sub: "u",
      iss: ISS,
      exp: Math.floor(now / 1000) + 600,
    });
    expect(
      await verifySessionToken(unknownKid, { jwks: [jwk], allowedIssuers: [ISS] }),
    ).toBeNull();

    const valid = await buildToken(privateKey, header, {
      sub: "u",
      iss: ISS,
      exp: Math.floor(now / 1000) + 600,
    });
    const tampered = `${valid.slice(0, -4)}AAAA`;
    await expect(
      verifySessionToken(tampered, { jwks: [jwk], allowedIssuers: [ISS] }),
    ).resolves.toBeNull();
  });

  it("verifySessionToken accepts RS256 tokens (production Clerk instances sign with RSA)", async () => {
    const { privateKey, jwk } = await makeRsaKey("rsa-key");
    const exp = Math.floor(Date.now() / 1000) + 600;
    const token = await buildToken(
      privateKey,
      { alg: "RS256", kid: "rsa-key", typ: "JWT" },
      { sub: "user_rsa", iss: ISS, azp: AZP, exp },
    );

    const payload = await verifySessionToken(token, {
      jwks: [jwk],
      allowedIssuers: [ISS],
      azpApex: "test.example.com",
    });
    expect(payload?.sub).toBe("user_rsa");
  });

  it("verifySessionToken rejects a tampered RS256 token and an alg/key-type mismatch", async () => {
    const { privateKey, jwk } = await makeRsaKey("rsa-key");
    const exp = Math.floor(Date.now() / 1000) + 600;
    const header = { alg: "RS256", kid: "rsa-key", typ: "JWT" };

    const valid = await buildToken(privateKey, header, {
      sub: "u",
      iss: ISS,
      exp,
    });
    const tampered = `${valid.slice(0, -4)}AAAA`;
    await expect(
      verifySessionToken(tampered, { jwks: [jwk], allowedIssuers: [ISS] }),
    ).resolves.toBeNull();

    // ES256 header against an RSA key: Web Crypto importKey fails, which must
    // surface as a null payload (401 semantics), not a thrown error.
    const { privateKey: ecKey } = await makeKey("rsa-key");
    const mismatched = await buildToken(ecKey, { ...header, alg: "ES256" }, {
      sub: "u",
      iss: ISS,
      exp,
    });
    await expect(
      verifySessionToken(mismatched, { jwks: [jwk], allowedIssuers: [ISS] }),
    ).resolves.toBeNull();
  });

  it("verifyRs256 validates RSA signatures with pure BigInt math (no subtle.verify)", async () => {
    const { privateKey, jwk } = await makeRsaKey("rsa-key");
    const signingInput = `${b64urlJson({ alg: "RS256", kid: "rsa-key" })}.${b64urlJson({
      sub: "u",
      exp: 1_900_000_000,
    })}`;
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        { name: "RSASSA-PKCS1-v1_5" },
        privateKey,
        encoder.encode(signingInput),
      ),
    );

    await expect(verifyRs256(jwk, signingInput, signature, crypto)).resolves.toBe(true);

    const flipped = signature.slice();
    flipped[0] ^= 0xff;
    await expect(verifyRs256(jwk, signingInput, flipped, crypto)).resolves.toBe(false);

    // Malformed inputs degrade to false instead of throwing.
    await expect(
      verifyRs256({ ...jwk, n: "!!!" }, signingInput, signature, crypto),
    ).resolves.toBe(false);
    await expect(verifyRs256(jwk, signingInput, signature.slice(1), crypto)).resolves.toBe(false);
  });

  it("verifyTokenDetailed verifies RS256 without RSA support in crypto.subtle (edge regression)", async () => {
    const { privateKey, jwk } = await makeRsaKey("rsa-key");
    const exp = Math.floor(Date.now() / 1000) + 600;
    const token = await buildToken(
      privateKey,
      { alg: "RS256", kid: "rsa-key", typ: "JWT" },
      { sub: "user_edge", iss: ISS, azp: AZP, exp },
    );

    // EdgeOne's runtime throws on RSA importKey/verify while digest() works;
    // RS256 must still verify through the pure-JS path instead of surfacing
    // the reason "crypto" like the production incident did.
    const edgeCrypto = {
      subtle: {
        digest: (alg: AlgorithmIdentifier, data: BufferSource) =>
          crypto.subtle.digest(alg, data),
        importKey: () => {
          throw new Error("RSASSA-PKCS1-v1_5 unsupported");
        },
        verify: async () => {
          throw new Error("RSASSA-PKCS1-v1_5 unsupported");
        },
      },
    } as unknown as Crypto;

    await expect(
      verifyTokenDetailed(token, {
        jwks: [jwk],
        allowedIssuers: [ISS],
        azpApex: "test.example.com",
        crypto: edgeCrypto,
      }),
    ).resolves.toMatchObject({ ok: true, payload: { sub: "user_edge" } });
  });

  it("verifyTokenDetailed pins the issuer and rejects unknown iss / mismatched azp", async () => {
    const { privateKey, jwk } = await makeKey("test-key");
    const now = Date.now();
    const exp = Math.floor(now / 1000) + 600;

    // Attacker-chosen iss must never be trusted (fake-JWKS auth bypass).
    const foreignIss = await buildToken(privateKey, { alg: "ES256", kid: "test-key" }, {
      sub: "u",
      iss: "https://evil.example.com",
      exp,
    });
    await expect(
      verifyTokenDetailed(foreignIss, { jwks: [jwk], now, allowedIssuers: [ISS] }),
    ).resolves.toMatchObject({ ok: false, reason: "iss" });

    const badAzp = await buildToken(privateKey, { alg: "ES256", kid: "test-key" }, {
      sub: "u",
      iss: ISS,
      azp: "https://other.example.com",
      exp,
    });
    await expect(
      verifyTokenDetailed(badAzp, {
        jwks: [jwk],
        now,
        allowedIssuers: [ISS],
        azpApex: "test.example.com",
      }),
    ).resolves.toMatchObject({ ok: false, reason: "azp" });

    // Old Clerk instances may omit azp: allowed when absent.
    const noAzp = await buildToken(privateKey, { alg: "ES256", kid: "test-key" }, {
      sub: "u",
      iss: ISS,
      exp,
    });
    await expect(
      verifyTokenDetailed(noAzp, { jwks: [jwk], now, allowedIssuers: [ISS] }),
    ).resolves.toMatchObject({ ok: true });

    // Same-party origins pass: the apex itself plus any subdomain depth —
    // Clerk JS stamps azp with the browsing origin, and all *.apex origins
    // share one identity. A regression here logs out users on that origin.
    for (const origin of [
      "https://test.example.com",
      AZP,
      "https://www.app.test.example.com",
    ]) {
      const token = await buildToken(privateKey, { alg: "ES256", kid: "test-key" }, {
        sub: "u",
        iss: ISS,
        azp: origin,
        exp,
      });
      await expect(
        verifyTokenDetailed(token, {
          jwks: [jwk],
          now,
          allowedIssuers: [ISS],
          azpApex: "test.example.com",
        }),
      ).resolves.toMatchObject({ ok: true });
    }

    // A lookalike domain sharing only a suffix fragment stays rejected
    // (leading-dot boundary prevents ends-with false positives).
    const lookalike = await buildToken(privateKey, { alg: "ES256", kid: "test-key" }, {
      sub: "u",
      iss: ISS,
      azp: "https://test.example.com.evil.com",
      exp,
    });
    await expect(
      verifyTokenDetailed(lookalike, {
        jwks: [jwk],
        now,
        allowedIssuers: [ISS],
        azpApex: "test.example.com",
      }),
    ).resolves.toMatchObject({ ok: false, reason: "azp" });
  });

  it("verifyTokenDetailed enforces the nbf and sts claims", async () => {
    const { privateKey, jwk } = await makeKey("test-key");
    const now = Date.now();
    const exp = Math.floor(now / 1000) + 600;

    const notYet = await buildToken(privateKey, { alg: "ES256", kid: "test-key" }, {
      sub: "u",
      iss: ISS,
      exp,
      nbf: Math.floor(now / 1000) + 60,
    });
    await expect(
      verifyTokenDetailed(notYet, { jwks: [jwk], now, allowedIssuers: [ISS] }),
    ).resolves.toMatchObject({ ok: false, reason: "nbf" });

    const inactive = await buildToken(privateKey, { alg: "ES256", kid: "test-key" }, {
      sub: "u",
      iss: ISS,
      exp,
      sts: "pending",
    });
    await expect(
      verifyTokenDetailed(inactive, { jwks: [jwk], now, allowedIssuers: [ISS] }),
    ).resolves.toMatchObject({ ok: false, reason: "sts" });

    const active = await buildToken(privateKey, { alg: "ES256", kid: "test-key" }, {
      sub: "u",
      iss: ISS,
      exp,
      sts: "active",
    });
    await expect(
      verifyTokenDetailed(active, { jwks: [jwk], now, allowedIssuers: [ISS] }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("verifyTokenDetailed force-refreshes the JWKS once when the kid is unknown", async () => {
    const { privateKey, jwk } = await makeKey("rotated-key");
    const now = Date.now();
    const exp = Math.floor(now / 1000) + 600;
    const token = await buildToken(privateKey, { alg: "ES256", kid: "rotated-key" }, {
      sub: "u",
      iss: ISS,
      exp,
    });

    // Stale cache serves the old key set; the forced refresh returns the
    // rotated one. Covers key rotation and the stale-JWKS-cache failure mode.
    let calls = 0;
    const fetchJwks = async (_iss: string, opts?: { forceRefresh?: boolean }) => {
      calls += 1;
      return opts?.forceRefresh ? [jwk] : [{ kid: "old-key" }];
    };
    await expect(
      verifyTokenDetailed(token, { now, fetchJwks, allowedIssuers: [ISS] }),
    ).resolves.toMatchObject({ ok: true });
    expect(calls).toBe(2);

    // Unknown kid after a refresh (or with injected keys) stays a rejection
    // without any further fetch.
    calls = 0;
    const stillMissing = await buildToken(privateKey, { alg: "ES256", kid: "ghost" }, {
      sub: "u",
      iss: ISS,
      exp,
    });
    await expect(
      verifyTokenDetailed(stillMissing, { now, fetchJwks, allowedIssuers: [ISS] }),
    ).resolves.toMatchObject({ ok: false, reason: "kid" });
    expect(calls).toBe(2);

    // Injected jwks skip the network path entirely, including the refresh.
    await expect(
      verifyTokenDetailed(stillMissing, {
        jwks: [{ kid: "other" }],
        now,
        allowedIssuers: [ISS],
      }),
    ).resolves.toMatchObject({ ok: false, reason: "kid" });
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

  it("treats the EO-Client-IP fallback header as an EdgeOne source", () => {
    expect(
      extractClientIp({ "eo-client-ip": "4.4.4.4", "x-forwarded-for": "1.1.1.1" }),
    ).toEqual({ ip: "4.4.4.4", source: "eo-client-ip" });
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
