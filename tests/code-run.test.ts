import { describe, expect, it } from "vitest";
import {
  consumeRunQuota,
  errorText,
  execute,
  flattenKernelOutput,
  isAllowedAzp,
  onRequest,
  readAgentSessionUid,
  siteApex,
  verifyAgentSession,
} from "../agents/code-run/index";

/**
 * Unit coverage for the Makers agent endpoint in agents/code-run/index.ts.
 *
 * The endpoint now gates every action behind Clerk session verification, so
 * full onRequest round-trips would need a live JWKS network call for any
 * authenticated path. Coverage is therefore split:
 * - code execution contracts (kernel output normalization, bash passthrough)
 *   are pinned by calling the exported `execute` directly with fake sandboxes;
 * - `onRequest` keeps one integration test for the anonymous 401 gate;
 * - auth (JWT verify, cookie/uid extraction, site apex/azp rules) and the
 *   hourly run quota are exercised through exported pure functions with
 *   injected deps (Node WebCrypto signs test tokens; no real network).
 */

const encoder = new TextEncoder();

type RunCodeOut = { results?: unknown; logs?: unknown; error?: unknown } | null;

function kernelSandbox(runCodeOut: RunCodeOut) {
  return {
    runCode: async (): Promise<RunCodeOut> => runCodeOut,
    getInfo: async (): Promise<Record<string, unknown>> => ({}),
  };
}

function bashSandbox(runOut: { stdout?: unknown; stderr?: unknown; exitCode?: unknown }) {
  return {
    commands: { run: async (): Promise<typeof runOut> => runOut },
    getInfo: async (): Promise<Record<string, unknown>> => ({}),
  };
}

describe("code-run execute: kernel output normalization", () => {
  it("extracts stream receipt blocks from results into plain stdout with real newlines", async () => {
    const out = await execute(
      kernelSandbox({
        logs: [],
        results: [{ stdout: ["Hello from EdgeOne!\ntick 0\ntick 1\ntick 2\n"], stderr: [] }],
      }),
      "python",
      'print("Hello from EdgeOne!")',
      30,
    );
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toBe("Hello from EdgeOne!\ntick 0\ntick 1\ntick 2\n");
    expect(out.stderr).toBe("");
    expect(out.results).toEqual([]);
    expect(out.error).toBe("");
  });

  it("renders {name,message,traceback} error objects as readable text with exitCode 1", async () => {
    const out = await execute(
      kernelSandbox({
        logs: [],
        results: [{ stdout: [], stderr: [] }],
        error: {
          name: "ZeroDivisionError",
          message: "division by zero",
          traceback: "Traceback (most recent call last)\nCell In[4], line 5",
        },
      }),
      "python",
      "print(a / b)",
      30,
    );
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toBe(
      "ZeroDivisionError: division by zero\nTraceback (most recent call last)\nCell In[4], line 5",
    );
    expect(out.error).toBe(out.stderr);
    expect(out.stdout).toBe("");
  });

  it("joins string logs into stdout (legacy shape regression)", async () => {
    const out = await execute(
      kernelSandbox({ logs: ["line one\n", "line two\n"], results: [] }),
      "javascript",
      "console.log('x')",
      30,
    );
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toBe("line one\nline two\n");
  });

  it("keeps rich (non-stream) result objects intact while consuming stream blocks", async () => {
    const out = await execute(
      kernelSandbox({
        logs: [],
        results: [{ "text/plain": "42" }, { stdout: ["printed\n"], stderr: [] }],
      }),
      "python",
      "42",
      30,
    );
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toBe("printed\n");
    expect(out.results).toEqual([{ "text/plain": "42" }]);
  });
});

describe("code-run execute: bash passthrough", () => {
  it("maps commands.run output to stdout/stderr/exitCode unchanged", async () => {
    const out = await execute(
      bashSandbox({ stdout: "hi\n", stderr: "", exitCode: 0 }),
      "bash",
      "echo hi",
      30,
    );
    expect(out.stdout).toBe("hi\n");
    expect(out.stderr).toBe("");
    expect(out.exitCode).toBe(0);
    expect(out.results).toEqual([]);
  });
});

describe("code-run onRequest: login gate", () => {
  it("rejects anonymous requests with 401 unauthorized and an x-auth-fail diagnostic", async () => {
    const res = await onRequest({
      request: { body: { action: "run", language: "python", code: "1" }, headers: {} },
      conversation_id: "c1",
      // Structural subset of SandboxLike; the endpoint only touches what it needs.
      sandbox: kernelSandbox({ logs: [], results: [] }) as never,
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("x-auth-fail")).toBe("no-cookie");
    await expect(res.json()).resolves.toEqual({ ok: false, error: "unauthorized" });
  });
});

describe("consumeRunQuota: 10 runs per hour, sliding window", () => {
  it("allows 10 runs then denies with a retry-after of the oldest stamp", () => {
    const bucket = new Map<string, number[]>();
    const start = 1_000_000;
    for (let i = 0; i < 10; i += 1) {
      expect(consumeRunQuota(bucket, "u1", start + i).allowed).toBe(true);
    }
    const denied = consumeRunQuota(bucket, "u1", start + 20);
    expect(denied.allowed).toBe(false);
    // Oldest stamp is `start`; ceil((start + 3_600_000 - (start + 20)) / 1000) = 3600.
    expect(denied.retryAfterSec).toBe(3600);
  });

  it("frees the quota once all stamps expire; users are counted independently", () => {
    const bucket = new Map<string, number[]>();
    const start = 5_000_000;
    for (let i = 0; i < 10; i += 1) consumeRunQuota(bucket, "u1", start + i);
    // Advance past the full window for every stamp (oldest offset is 9s),
    // then the next run is allowed and only the fresh stamp remains.
    const later = start + 3_600_010;
    expect(consumeRunQuota(bucket, "u1", later).allowed).toBe(true);
    expect(bucket.get("u1")).toEqual([later]);
    // A different user starts from an empty window.
    expect(consumeRunQuota(bucket, "u2", start).allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Session JWT verification (test tokens are signed locally with Node
// WebCrypto; verifyAgentSession runs with fully injected deps — no network).
// ---------------------------------------------------------------------------

function b64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlJson(value: unknown): string {
  return b64urlEncode(encoder.encode(JSON.stringify(value)));
}

async function generateSigningKey(alg: "ES256" | "RS256", kid = "test-key") {
  const pair = (await crypto.subtle.generateKey(
    alg === "ES256"
      ? { name: "ECDSA", namedCurve: "P-256" }
      : {
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

async function signJwt(
  alg: "ES256" | "RS256",
  keys: { privateKey: CryptoKey },
  payload: Record<string, unknown>,
  kid = "test-key",
): Promise<string> {
  const header = { alg, kid, typ: "JWT" };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const signature = await crypto.subtle.sign(
    alg === "ES256" ? { name: "ECDSA", hash: "SHA-256" } : { name: "RSASSA-PKCS1-v1_5" },
    keys.privateKey,
    encoder.encode(signingInput),
  );
  return `${signingInput}.${b64urlEncode(new Uint8Array(signature))}`;
}

function sessionPayload(now: number): Record<string, unknown> {
  const nowSec = Math.floor(now / 1000);
  return {
    iss: "https://clerk.example.com",
    sub: "user_123",
    azp: "https://www.example.com",
    nbf: nowSec - 10,
    exp: nowSec + 300,
    sts: "active",
  };
}

describe("verifyAgentSession: valid tokens (ES256 + RS256)", () => {
  it("accepts an ES256 session token signed by a whitelisted issuer", async () => {
    const now = Date.now();
    const keys = await generateSigningKey("ES256");
    const token = await signJwt("ES256", keys, sessionPayload(now));
    const result = await verifyAgentSession(token, {
      azpApex: "example.com",
      jwks: [keys.jwk],
      now,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.sub).toBe("user_123");
  });

  it("accepts an RS256 session token via the pure-JS BigInt verification path", async () => {
    const now = Date.now();
    const keys = await generateSigningKey("RS256");
    const token = await signJwt("RS256", keys, sessionPayload(now));
    const result = await verifyAgentSession(token, {
      azpApex: "example.com",
      jwks: [keys.jwk],
      now,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.sub).toBe("user_123");
  });
});

describe("verifyAgentSession: rejection reasons feed x-auth-fail", () => {
  it("rejects a token signed by a rogue key", async () => {
    const now = Date.now();
    const legit = await generateSigningKey("ES256");
    const rogue = await generateSigningKey("ES256");
    const token = await signJwt("ES256", rogue, sessionPayload(now));
    expect(
      await verifyAgentSession(token, { azpApex: "example.com", jwks: [legit.jwk], now }),
    ).toEqual({ ok: false, reason: "sig" });
  });

  it("rejects tokens from issuers outside the whitelist derived from azpApex", async () => {
    const now = Date.now();
    const keys = await generateSigningKey("ES256");
    const token = await signJwt("ES256", keys, {
      ...sessionPayload(now),
      iss: "https://clerk.notexample.com",
    });
    expect(
      await verifyAgentSession(token, { azpApex: "example.com", jwks: [keys.jwk], now }),
    ).toEqual({ ok: false, reason: "iss" });
  });

  it("rejects tokens whose azp host is not the site apex or a subdomain", async () => {
    const now = Date.now();
    const keys = await generateSigningKey("ES256");
    const token = await signJwt("ES256", keys, {
      ...sessionPayload(now),
      azp: "https://www.notexample.com",
    });
    expect(
      await verifyAgentSession(token, { azpApex: "example.com", jwks: [keys.jwk], now }),
    ).toEqual({ ok: false, reason: "azp" });
  });

  it("rejects expired tokens (5s clock tolerance)", async () => {
    const now = Date.now();
    const keys = await generateSigningKey("ES256");
    const token = await signJwt("ES256", keys, {
      ...sessionPayload(now),
      exp: Math.floor(now / 1000) - 100,
    });
    expect(
      await verifyAgentSession(token, { azpApex: "example.com", jwks: [keys.jwk], now }),
    ).toEqual({ ok: false, reason: "exp" });
  });

  it("rejects unknown algorithms before touching keys (alg:HS256)", async () => {
    const token = `${b64urlJson({ alg: "HS256", typ: "JWT" })}.${b64urlJson(
      sessionPayload(Date.now()),
    )}.${b64urlEncode(encoder.encode("junk"))}`;
    expect(
      await verifyAgentSession(token, { azpApex: "example.com" }),
    ).toEqual({ ok: false, reason: "alg:HS256" });
  });
});

describe("readAgentSessionUid: cookie + env wiring", () => {
  it("reads __session from a plain-object header, derives apex from env, returns uid", async () => {
    const now = Date.now();
    const keys = await generateSigningKey("ES256");
    const token = await signJwt("ES256", keys, sessionPayload(now));
    const out = await readAgentSessionUid(
      { cookie: `__session=${token}; other=1` },
      { SITE_DOMAIN: "https://www.example.com" },
      { jwks: [keys.jwk], now },
    );
    expect(out).toEqual({ uid: "user_123", reason: null });
  });

  it("reports no-cookie when the headers carry no session token", async () => {
    expect(await readAgentSessionUid({}, undefined)).toEqual({
      uid: null,
      reason: "no-cookie",
    });
  });
});

describe("site/domain helpers", () => {
  it("siteApex strips protocol, path and www; empty/non-string input is null", () => {
    expect(siteApex("https://www.example.com/path?q=1")).toBe("example.com");
    expect(siteApex("http://example.com")).toBe("example.com");
    expect(siteApex("Example.COM")).toBe("example.com");
    expect(siteApex("")).toBeNull();
    expect(siteApex("   ")).toBeNull();
    expect(siteApex(42)).toBeNull();
  });

  it("isAllowedAzp matches the apex and its subdomains only", () => {
    expect(isAllowedAzp("https://example.com", "example.com")).toBe(true);
    expect(isAllowedAzp("https://www.example.com", "example.com")).toBe(true);
    expect(isAllowedAzp("https://app.example.com", "example.com")).toBe(true);
    // Prefix lookalikes must not pass the leading-dot boundary check.
    expect(isAllowedAzp("https://notexample.com", "example.com")).toBe(false);
    expect(isAllowedAzp("https://example.com.evil.com", "example.com")).toBe(false);
    expect(isAllowedAzp(undefined, "example.com")).toBe(false);
  });
});

describe("output normalization primitives", () => {
  it("flattenKernelOutput splits stream blocks from rich results", () => {
    const { stdout, stderr, results } = flattenKernelOutput({
      logs: [],
      results: [{ "text/plain": "42" }, { stdout: ["printed\n"], stderr: ["oops\n"] }],
    });
    expect(stdout).toBe("printed\n");
    expect(stderr).toBe("oops\n");
    expect(results).toEqual([{ "text/plain": "42" }]);
  });

  it("errorText formats {name,message,traceback} and collapses empty values", () => {
    expect(errorText({ name: "E", message: "m", traceback: "t" })).toBe("E: m\nt");
    expect(errorText("boom")).toBe("boom");
    expect(errorText(null)).toBe("");
    expect(errorText(undefined)).toBe("");
  });
});
