import { describe, expect, it } from "vitest";
import { resolveVerifyKeys, sanitizeVerifyDetail } from "../app/lib/session";

/**
 * Unit tests for the pure helpers exported by app/lib/session.ts.
 * The cookie/verifyToken plumbing itself needs a request scope and is
 * covered by production smoke checks (next start) instead.
 */

describe("sanitizeVerifyDetail", () => {
  it("extracts the message from an Error", () => {
    expect(sanitizeVerifyDetail(new Error("JWKS fetch failed"))).toBe("JWKS fetch failed");
  });

  it("accepts plain strings", () => {
    expect(sanitizeVerifyDetail("Invalid token")).toBe("Invalid token");
  });

  it("returns null for nullish, blank, and non-error objects", () => {
    expect(sanitizeVerifyDetail(null)).toBeNull();
    expect(sanitizeVerifyDetail(undefined)).toBeNull();
    expect(sanitizeVerifyDetail("   ")).toBeNull();
    expect(sanitizeVerifyDetail({ code: "no-message" })).toBeNull();
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
