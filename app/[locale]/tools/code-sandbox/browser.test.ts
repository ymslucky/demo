import { describe, expect, it } from "vitest";
import {
  browserStepArg,
  browserStepReady,
  makeBrowserStep,
  moveBrowserStep,
  normalizeBrowserPayload,
  normalizeBrowserSteps,
  removeBrowserStep,
  type BrowserStep,
} from "./browser";

/** Unit coverage for the browser-workbench pure logic (moved from utils.test.ts). */

describe("browser queue helpers", () => {
  const step = (over: Partial<BrowserStep>): BrowserStep => ({ ...makeBrowserStep("goto", "seed"), ...over });

  it("browserStepReady enforces per-op required fields", () => {
    expect(browserStepReady(step({ op: "goto", url: "https://x.com" }))).toBe(true);
    expect(browserStepReady(step({ op: "goto", url: "   " }))).toBe(false);
    expect(browserStepReady(step({ op: "click", selector: "button" }))).toBe(true);
    expect(browserStepReady(step({ op: "type", selector: "" }))).toBe(false);
    expect(browserStepReady(step({ op: "evaluate", script: "1+1" }))).toBe(true);
    expect(browserStepReady(step({ op: "evaluate", script: "" }))).toBe(false);
    expect(browserStepReady(step({ op: "getContent" }))).toBe(true);
    expect(browserStepReady(step({ op: "screenshot" }))).toBe(true);
    expect(browserStepReady(step({ op: "close" }))).toBe(true);
  });

  it("browserStepArg renders the display argument per op", () => {
    expect(browserStepArg(step({ op: "goto", url: "https://x.com" }))).toBe("https://x.com");
    expect(browserStepArg(step({ op: "click", selector: "#go" }))).toBe("#go");
    expect(browserStepArg(step({ op: "type", selector: "#q", text: "hi" }))).toBe("#q | hi");
    expect(
      browserStepArg(step({ op: "evaluate", script: "\n  // comment\n  document.title\n" })),
    ).toBe("// comment");
    expect(browserStepArg(step({ op: "evaluate", script: "x".repeat(80) }))).toHaveLength(61);
    expect(browserStepArg(step({ op: "screenshot" }))).toBe("");
    expect(browserStepArg(step({ op: "close" }))).toBe("");
  });

  it("moveBrowserStep reorders without mutating and clamps at the edges", () => {
    const steps = [step({ id: "a" }), step({ id: "b" }), step({ id: "c" })];
    const moved = moveBrowserStep(steps, "c", -1);
    expect(moved.map((s) => s.id)).toEqual(["a", "c", "b"]);
    expect(steps.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(moveBrowserStep(steps, "a", -1).map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(moveBrowserStep(steps, "c", 1).map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(moveBrowserStep(steps, "missing", 1).map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("removeBrowserStep filters by id", () => {
    const steps = [step({ id: "a" }), step({ id: "b" })];
    expect(removeBrowserStep(steps, "a").map((s) => s.id)).toEqual(["b"]);
    expect(removeBrowserStep(steps, "zzz")).toHaveLength(2);
  });

  it("normalizeBrowserSteps drops malformed entries but keeps the valid ones", () => {
    expect(normalizeBrowserSteps("nope")).toBeNull();
    const steps = normalizeBrowserSteps([
      { id: "a", op: "goto", url: "https://x.com" },
      { op: "reload" },
      null,
      { id: "b", op: "click", selector: "button", url: 42 },
    ]);
    expect(steps?.map((s) => s.id)).toEqual(["a", "b"]);
    expect(steps?.[1].selector).toBe("button");
    expect(steps?.[1].url).toBe("");
  });
});

describe("normalizeBrowserPayload", () => {
  it("parses a well-formed browser action response", () => {
    const payload = normalizeBrowserPayload({
      ok: true,
      action: "browser",
      steps: [
        { op: "goto", ok: true, summary: "x - HTTP 200", error: "", base64Image: "B64", elapsedMs: 12 },
        { op: "getContent", ok: false, summary: "", error: "boom", content: "<p/>", elapsedMs: 3 },
      ],
      browser: { liveUrl: "https://live.example", cdpUrl: "" },
      sandbox: { instanceId: "i-1", expiresAt: "2026-09-11T12:00:00Z" },
    });
    expect(payload?.ok).toBe(true);
    expect(payload?.steps).toHaveLength(2);
    expect(payload?.steps[0].base64Image).toBe("B64");
    expect(payload?.steps[1].ok).toBe(false);
    expect(payload?.liveUrl).toBe("https://live.example");
    expect(payload?.sandbox.instanceId).toBe("i-1");
  });

  it("returns null for malformed shapes", () => {
    expect(normalizeBrowserPayload(null)).toBeNull();
    expect(normalizeBrowserPayload({ ok: true })).toBeNull();
    expect(normalizeBrowserPayload({ ok: true, steps: "no" })).toBeNull();
  });

  it("tolerates missing browser/sandbox blocks with safe defaults", () => {
    const payload = normalizeBrowserPayload({ ok: true, steps: [] });
    expect(payload?.liveUrl).toBe("");
    expect(payload?.sandbox.instanceId).toBeUndefined();
    expect(payload?.error).toBe("");
  });
});
