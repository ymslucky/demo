import { describe, expect, it } from "vitest";
import { onRequest } from "../agents/code-run/index";

/**
 * Unit coverage for the Makers agent endpoint in agents/code-run/index.ts.
 * The real kernel (sandbox.runCode) returns stream receipt blocks
 * {stdout: string[], stderr: string[]} inside `results` and error objects
 * {name, message, traceback}; these tests pin the normalization contract
 * that the browser terminal relies on (plain text stdout/stderr, real
 * newlines, readable error text).
 */

type RunCodeOut = { results?: unknown; logs?: unknown; error?: unknown } | null;

function kernelSandbox(runCodeOut: RunCodeOut) {
  return {
    runCode: async () => runCodeOut,
    getInfo: async () => ({}),
  };
}

function bashSandbox(runOut: { stdout?: unknown; stderr?: unknown; exitCode?: unknown }) {
  return {
    commands: { run: async () => runOut },
    getInfo: async () => ({}),
  };
}

async function run(sandbox: unknown, language: string, code: string) {
  const res = await onRequest({
    request: { body: { action: "run", language, code }, headers: {} },
    conversation_id: "c1",
    // Structural subset of SandboxLike; the endpoint only touches what it needs.
    sandbox: sandbox as never,
  });
  return (await res.json()) as Record<string, unknown>;
}

describe("code-run kernel output normalization", () => {
  it("extracts stream receipt blocks from results into plain stdout with real newlines", async () => {
    const payload = await run(
      kernelSandbox({
        logs: [],
        results: [{ stdout: ["Hello from EdgeOne!\ntick 0\ntick 1\ntick 2\n"], stderr: [] }],
      }),
      "python",
      'print("Hello from EdgeOne!")',
    );
    expect(payload.ok).toBe(true);
    expect(payload.exitCode).toBe(0);
    expect(payload.stdout).toBe("Hello from EdgeOne!\ntick 0\ntick 1\ntick 2\n");
    expect(payload.stderr).toBe("");
    expect(payload.results).toEqual([]);
  });

  it("renders {name,message,traceback} error objects as readable text with exitCode 1", async () => {
    const payload = await run(
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
    );
    expect(payload.exitCode).toBe(1);
    expect(payload.stderr).toBe(
      "ZeroDivisionError: division by zero\nTraceback (most recent call last)\nCell In[4], line 5",
    );
    expect(payload.error).toBe(payload.stderr);
    expect(payload.stdout).toBe("");
  });

  it("joins string logs into stdout (legacy shape regression)", async () => {
    const payload = await run(
      kernelSandbox({ logs: ["line one\n", "line two\n"], results: [] }),
      "javascript",
      "console.log('x')",
    );
    expect(payload.exitCode).toBe(0);
    expect(payload.stdout).toBe("line one\nline two\n");
  });

  it("keeps rich (non-stream) result objects intact while consuming stream blocks", async () => {
    const payload = await run(
      kernelSandbox({
        logs: [],
        results: [{ "text/plain": "42" }, { stdout: ["printed\n"], stderr: [] }],
      }),
      "python",
      "42",
    );
    expect(payload.exitCode).toBe(0);
    expect(payload.stdout).toBe("printed\n");
    expect(payload.results).toEqual([{ "text/plain": "42" }]);
  });
});

describe("code-run bash passthrough", () => {
  it("maps commands.run output to stdout/stderr/exitCode unchanged", async () => {
    const payload = await run(
      bashSandbox({ stdout: "hi\n", stderr: "", exitCode: 0 }),
      "bash",
      "echo hi",
    );
    expect(payload.ok).toBe(true);
    expect(payload.stdout).toBe("hi\n");
    expect(payload.stderr).toBe("");
    expect(payload.exitCode).toBe(0);
    expect(payload.results).toEqual([]);
  });
});
