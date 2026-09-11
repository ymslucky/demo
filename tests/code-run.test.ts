import { describe, expect, it } from "vitest";
import {
  b64urlEncode,
  b64urlJson,
  generateSigningKey,
  signJwt,
} from "./helpers/sign-jwt";
import {
  consumeRunQuota,
  errorText,
  execute,
  executeBrowserSteps,
  flattenKernelOutput,
  isAllowedAzp,
  onRequest,
  parseBrowserSteps,
  readAgentSessionUid,
  resolveQuotaPolicy,
  roleFromClaims,
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

describe("parseBrowserSteps: browser queue whitelist", () => {
  it("accepts a well-formed multi-step queue and keeps only known fields", () => {
    const steps = parseBrowserSteps([
      { op: "goto", url: "https://example.com" },
      { op: "type", selector: "input[name=q]", text: "hi", extra: "dropped" },
      { op: "click", selector: "button" },
      { op: "screenshot", fullPage: true },
      { op: "getContent" },
      { op: "evaluate", script: "1 + 1" },
      { op: "close" },
    ]);
    expect(steps).not.toBeNull();
    expect(steps?.map((s) => s.op)).toEqual([
      "goto",
      "type",
      "click",
      "screenshot",
      "getContent",
      "evaluate",
      "close",
    ]);
    expect(steps?.[1].text).toBe("hi");
    expect(steps?.[3].fullPage).toBe(true);
    expect("extra" in (steps?.[1] ?? {})).toBe(false);
  });

  it("rejects structurally invalid queues", () => {
    expect(parseBrowserSteps(undefined)).toBeNull();
    expect(parseBrowserSteps([])).toBeNull();
    expect(parseBrowserSteps("goto")).toBeNull();
    expect(parseBrowserSteps(Array.from({ length: 13 }, () => ({ op: "close" })))).toBeNull();
    expect(parseBrowserSteps([{ op: "reload" }])).toBeNull();
    expect(parseBrowserSteps([{ op: "goto" }])).toBeNull();
    expect(parseBrowserSteps([{ op: "click" }])).toBeNull();
    expect(parseBrowserSteps([{ op: "type", selector: "input" }, null])).toBeNull();
    expect(parseBrowserSteps([{ op: "evaluate", selector: "x" }])).toBeNull();
  });

  it("truncates overlong string fields to their caps", () => {
    const steps = parseBrowserSteps([{ op: "goto", url: "https://x.com/" + "a".repeat(5_000) }]);
    expect(steps?.[0].url?.length).toBe(2_000);
  });
});

describe("executeBrowserSteps: sequential browser ops with auto screenshots", () => {
  function browserSandbox(log: string[]) {
    return {
      browser: {
        goto: async (url: string) => {
          log.push(`goto:${url}`);
          return { url, title: "Example", status: 200 };
        },
        click: async (selector: string) => {
          log.push(`click:${selector}`);
          if (selector === "button[type=missing]") throw new Error("element not found");
        },
        type: async (selector: string, text: string) => {
          log.push(`type:${selector}=${text}`);
        },
        evaluate: async (script: string) => {
          log.push(`evaluate:${script}`);
          return { value: 42 };
        },
        getContent: async () => ({ content: "<html>hello</html>" }),
        screenshot: async (opts?: { fullPage?: boolean }) => {
          log.push(`shot:${opts?.fullPage === true ? "full" : "viewport"}`);
          return { base64Image: opts?.fullPage === true ? "FULLB64" : "VIEWB64" };
        },
        close: async () => {
          log.push("close");
        },
      },
      getInfo: async (): Promise<Record<string, unknown>> => ({}),
    };
  }

  it("runs ops in order, auto-captures viewport shots after goto/click/type only", async () => {
    const log: string[] = [];
    const sandbox = browserSandbox(log);
    const results = await executeBrowserSteps(sandbox, [
      { op: "goto", url: "https://example.com" },
      { op: "type", selector: "input[name=q]", text: "hi" },
      { op: "screenshot", fullPage: true },
      { op: "getContent" },
      { op: "close" },
    ]);
    expect(results.map((r) => r.ok)).toEqual([true, true, true, true, true]);
    // goto + type each get one auto viewport shot; the screenshot step itself
    // asks for a full-page shot; getContent/close get no auto shot.
    expect(log).toEqual([
      "goto:https://example.com",
      "shot:viewport",
      "type:input[name=q]=hi",
      "shot:viewport",
      "shot:full",
      "close",
    ]);
    expect(results[0].summary).toBe("https://example.com - HTTP 200 - Example");
    expect(results[0].base64Image).toBe("VIEWB64");
    expect(results[2].base64Image).toBe("FULLB64");
    expect(results[3].summary).toBe("18 chars");
    expect(results[3].content).toBe("<html>hello</html>");
    expect(results[3].base64Image).toBeUndefined();
  });

  it("stops the queue on the first failing step and reports the error", async () => {
    const log: string[] = [];
    const sandbox = browserSandbox(log);
    const results = await executeBrowserSteps(sandbox, [
      { op: "click", selector: "button[type=missing]" },
      { op: "goto", url: "https://example.com" },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toContain("element not found");
    // The queued goto after the failure was never executed, and the failing
    // step produced no auto screenshot (the throw skips the capture block).
    expect(log).toEqual(["click:button[type=missing]"]);
  });

  it("marks every step failed when the sandbox has no browser capability", async () => {
    const results = await executeBrowserSteps({}, [{ op: "goto", url: "https://x.com" }]);
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toContain("browser-unavailable");
  });
});

// ---------------------------------------------------------------------------
// Session JWT verification (test tokens are signed locally with Node
// WebCrypto via ./helpers/sign-jwt; verifyAgentSession runs with fully
// injected deps — no network).
// ---------------------------------------------------------------------------

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
    // No metadata claim in the default token -> empty role (fail-closed).
    expect(out).toEqual({ uid: "user_123", role: "", reason: null });
  });

  it("surfaces the admin role from the customized metadata claim", async () => {
    const now = Date.now();
    const keys = await generateSigningKey("ES256");
    const token = await signJwt("ES256", keys, {
      ...sessionPayload(now),
      metadata: { role: "admin" },
    });
    const out = await readAgentSessionUid(
      { cookie: `__session=${token}` },
      { SITE_DOMAIN: "https://www.example.com" },
      { jwks: [keys.jwk], now },
    );
    expect(out).toEqual({ uid: "user_123", role: "admin", reason: null });
  });

  it("reports no-cookie when the headers carry no session token", async () => {
    expect(await readAgentSessionUid({}, undefined)).toEqual({
      uid: null,
      role: "",
      reason: "no-cookie",
    });
  });
});

describe("roleFromClaims: role extraction from the signed metadata claim", () => {
  it("reads metadata.role when present and well-formed", () => {
    expect(roleFromClaims({ metadata: { role: "admin" } })).toBe("admin");
    expect(roleFromClaims({ metadata: { role: "moderator" } })).toBe("moderator");
    expect(roleFromClaims({ metadata: {} })).toBe("");
  });

  it("returns empty string for missing or malformed claims", () => {
    expect(roleFromClaims(null)).toBe("");
    expect(roleFromClaims(undefined)).toBe("");
    expect(roleFromClaims({})).toBe("");
    expect(roleFromClaims({ metadata: "admin" })).toBe("");
    expect(roleFromClaims({ metadata: { role: 42 } })).toBe("");
    expect(roleFromClaims({ metadata: { role: null } })).toBe("");
  });
});

describe("resolveQuotaPolicy: defaults + env overrides", () => {
  it("returns the built-in defaults without env config", () => {
    expect(resolveQuotaPolicy(undefined)).toEqual({
      runLimit: 10,
      browserLimit: 60,
      adminRole: "admin",
    });
  });

  it("applies positive integer overrides and falls back on garbage", () => {
    expect(resolveQuotaPolicy({ SANDBOX_RUN_QUOTA: "5", SANDBOX_BROWSER_QUOTA: "120" })).toEqual({
      runLimit: 5,
      browserLimit: 120,
      adminRole: "admin",
    });
    expect(resolveQuotaPolicy({ SANDBOX_RUN_QUOTA: "0", SANDBOX_BROWSER_QUOTA: "-3" }).runLimit).toBe(10);
    expect(resolveQuotaPolicy({ SANDBOX_RUN_QUOTA: "abc", SANDBOX_BROWSER_QUOTA: "" }).browserLimit).toBe(60);
    expect(resolveQuotaPolicy({ SANDBOX_RUN_QUOTA: "7.9" }).runLimit).toBe(7);
  });

  it("overrides the admin role name but falls back to admin on blanks", () => {
    expect(resolveQuotaPolicy({ SANDBOX_ADMIN_ROLE: "root" }).adminRole).toBe("root");
    expect(resolveQuotaPolicy({ SANDBOX_ADMIN_ROLE: "   " }).adminRole).toBe("admin");
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
