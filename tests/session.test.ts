import { describe, expect, it } from "vitest";
import {
  describeVerifyInput,
  resolveVerifyKeys,
  sanitizeVerifyDetail,
} from "../app/lib/session";

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
});
