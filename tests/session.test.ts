import { SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveIssuers, siteApex } from "@lucky/auth-core";
import {
  describeVerifyInput,
  matchAllowedIssuer,
  resolveVerifyKeys,
  sanitizeVerifyDetail,
} from "../app/lib/session";

/**
 * Unit tests for the pure helpers exported by app/lib/session.ts.
 * The cookie/verifyToken plumbing itself needs a request scope and is
 * covered by production smoke checks (next start) instead.
 * Pure auth predicates (siteApex / issuer derivation) are tested against
 * their single source of truth, shared/auth-core.js.
 */

describe("siteApex (shared/auth-core)", () => {
  it("normalizes bare, prefixed, and www forms to the apex domain", () => {
    expect(siteApex("rdom.cn")).toBe("rdom.cn");
    expect(siteApex("https://rdom.cn")).toBe("rdom.cn");
    expect(siteApex("https://www.rdom.cn/tools/")).toBe("rdom.cn");
    expect(siteApex("  RDOM.CN ")).toBe("rdom.cn");
  });

  it("returns null for blank or non-string input", () => {
    expect(siteApex(undefined)).toBeNull();
    expect(siteApex("   ")).toBeNull();
  });
});

describe("deriveIssuers (shared/auth-core)", () => {
  it("derives the clerk issuer from SITE_DOMAIN like the edge functions do", () => {
    expect(deriveIssuers({ siteDomain: "https://www.example.com" })).toEqual([
      "https://clerk.example.com",
    ]);
  });

  it("falls back to the rdom.cn default when SITE_DOMAIN is absent", () => {
    expect(deriveIssuers({})).toEqual(["https://clerk.rdom.cn"]);
  });

  it("prefers an explicit CLERK_ISSUER list over the SITE_DOMAIN derivation", () => {
    expect(
      deriveIssuers({ clerkIssuer: "https://a.example.com, https://b.example.com", siteDomain: "x.cn" }),
    ).toEqual(["https://a.example.com", "https://b.example.com"]);
  });
});

describe("matchAllowedIssuer", () => {
  const secret = new TextEncoder().encode("unit-test-secret-0123456789abcdef");

  async function tokenFor(iss: string): Promise<string> {
    return new SignJWT({ sub: "user_1" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(iss)
      .sign(secret);
  }

  it("matches a trailing-slash issuer to the canonical allowlist entry", async () => {
    const token = await tokenFor("https://clerk.rdom.cn/");
    expect(matchAllowedIssuer(token, ["https://clerk.rdom.cn"])).toBe("https://clerk.rdom.cn");
  });

  it("returns null for a non-allowlisted issuer (rogue instance)", async () => {
    const token = await tokenFor("https://clerk.attacker.example");
    expect(matchAllowedIssuer(token, ["https://clerk.rdom.cn"])).toBeNull();
  });

  it("returns null for a malformed token", () => {
    expect(matchAllowedIssuer("not-a-jwt", ["https://clerk.rdom.cn"])).toBeNull();
  });
});

describe("sanitizeVerifyDetail", () => {
  it("extracts the message from an Error", () => {
    expect(sanitizeVerifyDetail(new Error("JWKS fetch failed"))).toBe("JWKS fetch failed");
  });

  it("accepts plain strings", () => {
    expect(sanitizeVerifyDetail("Invalid token")).toBe("Invalid token");
  });

  it("returns null for nullish and blank inputs", () => {
    expect(sanitizeVerifyDetail(null)).toBeNull();
    expect(sanitizeVerifyDetail(undefined)).toBeNull();
    expect(sanitizeVerifyDetail("   ")).toBeNull();
  });

  it("falls back to the reason field for non-Error objects", () => {
    expect(sanitizeVerifyDetail({ reason: "TokenInvalid" })).toBe("TokenInvalid");
  });

  it("serializes opaque objects so the gate card is never blank", () => {
    expect(sanitizeVerifyDetail({ code: "no-message" })).toBe('{"code":"no-message"}');
  });

  it("prefers a string message field over reason on plain objects", () => {
    expect(sanitizeVerifyDetail({ message: "JWKS fetch failed", reason: "RemoteJWKFailedToLoad" })).toBe(
      "JWKS fetch failed",
    );
  });

  it("collapses whitespace so a single line survives the gate card", () => {
    expect(sanitizeVerifyDetail("line1\n  line2\tline3")).toBe("line1 line2 line3");
  });

  it("truncates long upstream messages to keep the card layout stable", () => {
    const long = "x".repeat(500);
    const out = sanitizeVerifyDetail(long);
    expect(out).not.toBeNull();
    expect(out?.length).toBe(200);
  });
});

describe("resolveVerifyKeys", () => {
  it("accepts a secret key alone", () => {
    expect(resolveVerifyKeys({ CLERK_SECRET_KEY: "sk_test_x" })).toEqual({
      secretKey: "sk_test_x",
      jwtKey: null,
    });
  });

  it("accepts a PEM public key alone and unescapes literal newlines", () => {
    const pem = ["-----BEGIN PUBLIC KEY-----", "ABCDEF", "-----END PUBLIC KEY-----"].join("\\n");
    expect(resolveVerifyKeys({ CLERK_JWT_PUBLIC_KEY: pem })).toEqual({
      secretKey: null,
      jwtKey: pem.replace(/\\n/g, "\n"),
    });
  });

  it("treats blank-string env vars as missing", () => {
    expect(resolveVerifyKeys({ CLERK_SECRET_KEY: "   ", CLERK_JWT_PUBLIC_KEY: "" })).toEqual({
      secretKey: null,
      jwtKey: null,
    });
  });

  it("returns both keys when both are configured", () => {
    expect(
      resolveVerifyKeys({ CLERK_SECRET_KEY: "sk_live_y", CLERK_JWT_PUBLIC_KEY: "-----KEY-----" }),
    ).toEqual({ secretKey: "sk_live_y", jwtKey: "-----KEY-----" });
  });
});

describe("describeVerifyInput", () => {
  it("reports absence of both key materials", () => {
    expect(describeVerifyInput({})).toBe("sk:no pem:no");
  });

  it("reports a secret key without a PEM", () => {
    expect(describeVerifyInput({ CLERK_SECRET_KEY: "sk_test_x" })).toBe("sk:yes pem:no");
  });

  it("summarizes PEM shape: length, head, and escaped newlines", () => {
    const pem = "-----BEGIN PUBLIC KEY-----\\nABCDEF\\n-----END PUBLIC KEY-----";
    const out = describeVerifyInput({ CLERK_SECRET_KEY: "sk_live_y", CLERK_JWT_PUBLIC_KEY: pem });
    // len counts the unescaped form: each literal \n (2 chars) becomes 1 char.
    expect(out).toBe(`sk:yes pem:yes(len=${pem.length - 2},head=-----BEGIN,esc=1)`);
  });

  it("flags an escaped-newline-free (multiline) PEM with esc=0", () => {
    const pem = "-----BEGIN PUBLIC KEY-----\nABCDEF\n-----END PUBLIC KEY-----";
    const out = describeVerifyInput({ CLERK_JWT_PUBLIC_KEY: pem });
    expect(out).toContain("esc=0");
    expect(out).toContain("head=-----BEGIN");
  });

  it("never leaks key material into the summary", () => {
    const secret = "sk_live_super_secret_value";
    const out = describeVerifyInput({ CLERK_SECRET_KEY: secret, CLERK_JWT_PUBLIC_KEY: "-----KEY-----" });
    expect(out).not.toContain("super_secret_value");
  });

  it("prefixes the summary with the verification channel tag", () => {
    expect(describeVerifyInput({}, "jwks")).toBe("via=jwks sk:no pem:no");
    expect(describeVerifyInput({}, "sk")).toBe("via=sk sk:no pem:no");
    expect(describeVerifyInput({}, "pem")).toBe("via=pem sk:no pem:no");
  });
});

describe("readSessionClaimsDetailed channel selection", () => {
  const secret = new TextEncoder().encode("unit-test-secret-0123456789abcdef");
  // Set by each test before calling the reader; read through the mocked
  // next/headers cookie jar below.
  const cookieJar = vi.hoisted(() => ({ token: null as string | null }));

  vi.mock("next/headers", () => ({
    cookies: async () => ({
      get: (name: string) =>
        name === "__session" && cookieJar.token ? { value: cookieJar.token } : undefined,
    }),
  }));

  afterEach(() => {
    cookieJar.token = null;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  async function tokenFor(iss: string): Promise<string> {
    return new SignJWT({ sub: "user_1" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(iss)
      .sign(secret);
  }

  it("routes a whitelisted issuer through the JWKS channel even with no key material", async () => {
    vi.stubEnv("CLERK_SECRET_KEY", "");
    vi.stubEnv("CLERK_JWT_PUBLIC_KEY", "");
    vi.stubEnv("SITE_DOMAIN", "rdom.cn");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ keys: [] }), { status: 200 })),
    );
    cookieJar.token = await tokenFor("https://clerk.rdom.cn");
    const { readSessionClaimsDetailed } = await import("../app/lib/session");
    const out = await readSessionClaimsDetailed();
    expect(out.reason).toBe("verify-failed");
    expect(out.input).toContain("via=jwks");
  });

  it("falls back to no-key when the issuer is off-list and no keys exist", async () => {
    vi.stubEnv("CLERK_SECRET_KEY", "");
    vi.stubEnv("CLERK_JWT_PUBLIC_KEY", "");
    vi.stubEnv("SITE_DOMAIN", "rdom.cn");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    cookieJar.token = await tokenFor("https://clerk.attacker.example");
    const { readSessionClaimsDetailed } = await import("../app/lib/session");
    const out = await readSessionClaimsDetailed();
    expect(out.reason).toBe("no-key");
    expect(out.input).toContain("pem:no");
    // The rogue issuer must never reach the network: no JWKS fetch happens.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
