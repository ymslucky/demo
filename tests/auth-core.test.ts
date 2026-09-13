import { describe, expect, it, vi } from "vitest";
import {
  deriveIssuers,
  isTokenFresh,
  parseTokenPayload,
  siteApex,
  verifySessionDetailed,
} from "@lucky/auth-core";
import {
  b64urlEncode,
  b64urlJson,
  generateEs256Keys,
  generateRs256JwkAndSign,
  signJwt,
} from "./helpers/sign-jwt";

/**
 * Unit coverage for @lucky/auth-core's session verifier.
 *
 * Every verifySessionDetailed call is fully injected (jwks / now / crypto /
 * fetchJwks / allowedIssuers / azpApex) — zero network. ES256 and RS256
 * tokens are signed locally with Node WebCrypto via ./helpers/sign-jwt.
 * The predicate assertions at the bottom converge the existing coverage
 * from session.test.ts / code-run.test.ts onto the package entry point.
 */

const ISSUER = "https://clerk.example.com";
const APEX = "example.com";

function sessionPayload(now: number, overrides: Record<string, unknown> = {}) {
  const nowSec = Math.floor(now / 1000);
  return {
    iss: ISSUER,
    sub: "user_123",
    azp: "https://www.example.com",
    nbf: nowSec - 10,
    exp: nowSec + 300,
    sts: "active",
    ...overrides,
  };
}

const baseDeps = (now: number, jwks?: Array<Record<string, unknown>>) => ({
  ...(jwks ? { jwks } : {}),
  now,
  allowedIssuers: [ISSUER],
  azpApex: APEX,
});

describe("verifySessionDetailed: happy paths", () => {
  it("accepts a valid ES256 token with the injected public JWK", async () => {
    const now = Date.now();
    const keys = await generateEs256Keys();
    const token = await signJwt("ES256", keys, sessionPayload(now));
    const result = await verifySessionDetailed(token, baseDeps(now, [keys.jwk]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.sub).toBe("user_123");
  });

  it("accepts a valid RS256 token via the pure-JS BigInt verification path", async () => {
    const now = Date.now();
    const keys = await generateRs256JwkAndSign();
    const token = await signJwt("RS256", keys, sessionPayload(now));
    const result = await verifySessionDetailed(token, baseDeps(now, [keys.jwk]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.sub).toBe("user_123");
  });
});

describe("verifySessionDetailed: rejection reasons feed x-auth-fail", () => {
  it("rejects a malformed token with reason parse", async () => {
    expect(
      await verifySessionDetailed("not-a-jwt", baseDeps(Date.now())),
    ).toEqual({ ok: false, reason: "parse" });
  });

  it("rejects unknown algorithms before touching keys (alg:HS256)", async () => {
    const token = `${b64urlJson({ alg: "HS256", typ: "JWT" })}.${b64urlJson(
      sessionPayload(Date.now()),
    )}.${b64urlEncode(new TextEncoder().encode("junk"))}`;
    expect(
      await verifySessionDetailed(token, baseDeps(Date.now())),
    ).toEqual({ ok: false, reason: "alg:HS256" });
  });

  it("rejects a rogue issuer and accepts a trailing-slash whitelist entry (normalization)", async () => {
    const now = Date.now();
    const keys = await generateEs256Keys();
    const rogue = await signJwt(
      "ES256",
      keys,
      sessionPayload(now, { iss: "https://clerk.notexample.com" }),
    );
    expect(await verifySessionDetailed(rogue, baseDeps(now, [keys.jwk]))).toEqual({
      ok: false,
      reason: "iss",
    });
    // Whitelist entry with a trailing slash must still match after
    // normalizeIssuer runs on both sides.
    const token = await signJwt("ES256", keys, sessionPayload(now));
    const ok = await verifySessionDetailed(token, {
      ...baseDeps(now, [keys.jwk]),
      allowedIssuers: ["https://clerk.example.com/"],
    });
    expect(ok).toEqual({ ok: true, payload: sessionPayload(now) });
  });

  it("rejects an azp pointing off-site and admits a token without azp", async () => {
    const now = Date.now();
    const keys = await generateEs256Keys();
    const evil = await signJwt(
      "ES256",
      keys,
      sessionPayload(now, { azp: "https://www.evil.com" }),
    );
    expect(await verifySessionDetailed(evil, baseDeps(now, [keys.jwk]))).toEqual({
      ok: false,
      reason: "azp",
    });
    // JSON.stringify drops undefined values -> the token carries no azp at
    // all, and a missing azp is admitted (aligned with the Clerk samples).
    const noAzp = await signJwt("ES256", keys, sessionPayload(now, { azp: undefined }));
    expect(await verifySessionDetailed(noAzp, baseDeps(now, [keys.jwk]))).toEqual({
      ok: true,
      payload: sessionPayload(now, { azp: undefined }),
    });
  });

  it("honors the 5s clock-skew window around exp: +59s passes, +61s fails", async () => {
    const now = Date.now();
    const keys = await generateEs256Keys();
    // Token expires 56s after `now`; advancing the clock 59s lands 3s past
    // exp (inside the 5s tolerance -> accepted), 61s lands at exp+5s, which
    // trips the `nowSec >= exp + CLOCK_SKEW_S` rejection.
    const payload = { ...sessionPayload(now), exp: Math.floor(now / 1000) + 56 };
    const token = await signJwt("ES256", keys, payload);
    const fresh = await verifySessionDetailed(token, baseDeps(now + 59_000, [keys.jwk]));
    expect(fresh.ok).toBe(true);
    const stale = await verifySessionDetailed(token, baseDeps(now + 61_000, [keys.jwk]));
    expect(stale).toEqual({ ok: false, reason: "exp" });
  });

  it("rejects a not-yet-valid token with reason nbf", async () => {
    const now = Date.now();
    const keys = await generateEs256Keys();
    const token = await signJwt(
      "ES256",
      keys,
      sessionPayload(now, { nbf: Math.floor(now / 1000) + 100 }),
    );
    expect(await verifySessionDetailed(token, baseDeps(now, [keys.jwk]))).toEqual({
      ok: false,
      reason: "nbf",
    });
  });

  it("rejects a non-active sts and admits a token without sts", async () => {
    const now = Date.now();
    const keys = await generateEs256Keys();
    const revoked = await signJwt(
      "ES256",
      keys,
      sessionPayload(now, { sts: "revoked" }),
    );
    expect(await verifySessionDetailed(revoked, baseDeps(now, [keys.jwk]))).toEqual({
      ok: false,
      reason: "sts",
    });
    // JSON.stringify drops undefined values -> no sts claim at all.
    const noSts = await signJwt("ES256", keys, sessionPayload(now, { sts: undefined }));
    expect(await verifySessionDetailed(noSts, baseDeps(now, [keys.jwk]))).toEqual({
      ok: true,
      payload: sessionPayload(now, { sts: undefined }),
    });
  });

  it("rejects when the kid is not in the injected jwks (no network path)", async () => {
    const now = Date.now();
    const keys = await generateEs256Keys();
    const other = await generateEs256Keys("other-key");
    const token = await signJwt("ES256", keys, sessionPayload(now));
    const result = await verifySessionDetailed(token, baseDeps(now, [other.jwk]));
    expect(result).toEqual({ ok: false, reason: "kid" });
  });

  it("rejects a tampered signature with reason sig", async () => {
    const now = Date.now();
    const keys = await generateEs256Keys();
    const token = await signJwt("ES256", keys, sessionPayload(now));
    // Corrupt the FIRST character of the signature segment: all six of its
    // bits are significant (they form the top bits of signature byte 0), so
    // swapping it always changes the decoded signature. Swapping the LAST
    // character was flaky — its low four bits are discarded base64 padding,
    // so an "A" -> "B" swap decoded to the identical final byte in ~25% of
    // runs and the tampered token still verified.
    const [header, payload, sig] = token.split(".");
    const swapped = sig.startsWith("A") ? "B" : "A";
    const tampered = `${header}.${payload}.${swapped}${sig.slice(1)}`;
    expect(
      await verifySessionDetailed(tampered, baseDeps(now, [keys.jwk])),
    ).toEqual({ ok: false, reason: "sig" });
  });

  it("fails closed on the RS256 path when handed an EC key (kty mismatch)", async () => {
    const now = Date.now();
    const rsa = await generateRs256JwkAndSign();
    const token = await signJwt("RS256", rsa, sessionPayload(now));
    const ec = await generateEs256Keys(); // same kid, wrong key type
    // The pure-JS RS256 path swallows the decode error and reports sig
    // (the Web Crypto path would report crypto) — both are accepted here.
    const result = await verifySessionDetailed(token, baseDeps(now, [ec.jwk]));
    expect(result).toEqual({ ok: false, reason: "sig" });
  });

  it("force-refreshes jwks once on a kid miss when fetching from the network", async () => {
    const now = Date.now();
    const keys = await generateEs256Keys();
    const fetchJwks = vi
      .fn<() => Promise<Array<Record<string, unknown>>>>()
      .mockResolvedValueOnce([{ kid: "stale-key" }])
      .mockResolvedValueOnce([keys.jwk]);
    const token = await signJwt("ES256", keys, sessionPayload(now));
    const result = await verifySessionDetailed(token, {
      now,
      fetchJwks,
      allowedIssuers: [ISSUER],
      azpApex: APEX,
    });
    expect(result.ok).toBe(true);
    expect(fetchJwks).toHaveBeenCalledTimes(2);
    expect(fetchJwks).toHaveBeenNthCalledWith(1, ISSUER);
    expect(fetchJwks).toHaveBeenNthCalledWith(2, ISSUER, { forceRefresh: true });
  });

  it("is fail-closed when allowedIssuers is omitted: every iss is rejected", async () => {
    const now = Date.now();
    const keys = await generateEs256Keys();
    const token = await signJwt("ES256", keys, sessionPayload(now));
    expect(await verifySessionDetailed(token, { jwks: [keys.jwk], now })).toEqual({
      ok: false,
      reason: "iss",
    });
  });
});

describe("exported predicates: converged existing assertions", () => {
  it("siteApex strips protocol/path/www and nulls blanks (from session.test.ts)", () => {
    expect(siteApex("rdom.cn")).toBe("rdom.cn");
    expect(siteApex("https://rdom.cn")).toBe("rdom.cn");
    expect(siteApex("https://www.rdom.cn/tools/")).toBe("rdom.cn");
    expect(siteApex("  RDOM.CN ")).toBe("rdom.cn");
    expect(siteApex(undefined)).toBeNull();
    expect(siteApex("   ")).toBeNull();
    expect(siteApex(42)).toBeNull();
  });

  it("deriveIssuers derives clerk.<apex>, prefers explicit lists, defaults to rdom.cn", () => {
    expect(deriveIssuers({ siteDomain: "https://www.example.com" })).toEqual([
      "https://clerk.example.com",
    ]);
    expect(
      deriveIssuers({ clerkIssuer: "https://a.example.com, https://b.example.com", siteDomain: "x.cn" }),
    ).toEqual(["https://a.example.com", "https://b.example.com"]);
    expect(deriveIssuers({})).toEqual(["https://clerk.rdom.cn"]);
  });

  it("isTokenFresh honors exp/nbf with the 5s skew; a missing nbf is unconstrained", () => {
    const now = 1_000_000_000_000;
    const sec = Math.floor(now / 1000);
    expect(isTokenFresh({ exp: sec + 10, nbf: sec - 10 }, now)).toBe(true);
    expect(isTokenFresh({ exp: sec - 10 }, now)).toBe(false);
    expect(isTokenFresh({ exp: sec + 10, nbf: sec + 100 }, now)).toBe(false);
    expect(isTokenFresh({ exp: sec + 10 }, now)).toBe(true);
    expect(isTokenFresh({}, now)).toBe(false);
  });

  it("parseTokenPayload splits three segments and nulls malformed tokens", () => {
    const token = `${b64urlJson({ alg: "ES256", kid: "k", typ: "JWT" })}.${b64urlJson({
      sub: "u",
    })}.${b64urlEncode(new TextEncoder().encode("sig"))}`;
    const parsed = parseTokenPayload(token);
    expect(parsed?.header).toEqual({ alg: "ES256", kid: "k", typ: "JWT" });
    expect(parsed?.payload).toEqual({ sub: "u" });
    expect(parsed?.signingInput).toBe(token.split(".").slice(0, 2).join("."));
    expect(parsed?.signature).toEqual(new TextEncoder().encode("sig"));
    expect(parseTokenPayload("not-a-jwt")).toBeNull();
    expect(parseTokenPayload(42)).toBeNull();
    expect(parseTokenPayload("a.b")).toBeNull();
  });
});
