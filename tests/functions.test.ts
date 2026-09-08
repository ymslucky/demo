import { describe, expect, it } from "vitest";
import {
  applyTap,
  counterKey,
  countTotals,
  isTokenFresh,
  parseTokenPayload,
  readSessionToken,
  sumCounts,
  verifyRs256,
  verifySessionToken,
  verifyTokenDetailed,
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
      allowedAzp: [AZP],
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
      allowedAzp: [AZP],
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
        allowedAzp: [AZP],
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
        allowedAzp: [AZP],
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
