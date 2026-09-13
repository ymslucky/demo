import { describe, expect, it } from "vitest";
import {
  browserStepArg,
  browserStepReady,
  canvasSize,
  clampZoom,
  duplicateBrowserStep,
  makeBrowserStep,
  moveStepTo,
  nodePosition,
  CANVAS_MARGIN,
  moveBrowserStep,
  normalizeBrowserPayload,
  normalizeBrowserSteps,
  removeBrowserStep,
  resetCanvasLayout,
  type BrowserStep,
} from "./browser";

describe("duplicateBrowserStep", () => {
  const step = (over: Partial<BrowserStep>): BrowserStep => ({
    ...makeBrowserStep("goto", "seed"),
    ...over,
  });

  it("inserts a fresh-id copy right after the original", () => {
    const steps = [step({ id: "a" }), step({ id: "b" })];
    const next = duplicateBrowserStep(steps, "a");
    expect(next).toHaveLength(3);
    expect(next[0].id).toBe("a");
    expect(next[1].id).not.toBe("a");
    expect(next[1].op).toBe(steps[0].op);
    expect(next[1].url).toBe(steps[0].url);
    expect(next[2].id).toBe("b");
    expect(steps).toHaveLength(2); // 原数组不变
  });

  it("is an identity no-op for unknown ids", () => {
    const steps = [step({ id: "a" })];
    expect(duplicateBrowserStep(steps, "ghost")).toBe(steps);
  });
});

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

describe("canvas helpers", () => {
  it("nodePosition falls back to a 3-column grid for unpositioned steps", () => {
    const steps = [makeBrowserStep("goto", "a"), makeBrowserStep("goto", "b"), makeBrowserStep("goto", "c"), makeBrowserStep("close", "d")];
    expect(nodePosition(steps[0], 0)).toEqual({ x: CANVAS_MARGIN, y: CANVAS_MARGIN });
    expect(nodePosition(steps[1], 1).x).toBeGreaterThan(CANVAS_MARGIN);
    expect(nodePosition(steps[1], 1).y).toBe(CANVAS_MARGIN);
    expect(nodePosition(steps[3], 3).y).toBeGreaterThan(nodePosition(steps[2], 2).y);
  });

  it("persisted x/y win over the default grid", () => {
    const s = makeBrowserStep("goto", "s");
    s.x = 500;
    s.y = 300;
    expect(nodePosition(s, 2)).toEqual({ x: 500, y: 300 });
  });

  it("moveStepTo clamps to non-negative ints and preserves order", () => {
    const steps = [makeBrowserStep("goto", "a"), makeBrowserStep("goto", "b")];
    const moved = moveStepTo(steps, "b", -40, 120.6);
    expect(moved[0]).toBe(steps[0]);
    expect(moved[1]).toMatchObject({ id: "b", x: 0, y: 121 });
  });

  it("canvasSize wraps all nodes with margin", () => {
    const steps = [makeBrowserStep("goto", "a")];
    steps[0].x = 1000;
    steps[0].y = 600;
    const size = canvasSize(steps);
    expect(size.width).toBeGreaterThan(1000);
    expect(size.height).toBeGreaterThan(600);
  });

  it("normalizeBrowserSteps preserves persisted node positions", () => {
    const steps = normalizeBrowserSteps([{ id: "a", op: "goto", url: "https://x.com", x: 40, y: 60 }]);
    expect(steps?.[0]).toMatchObject({ x: 40, y: 60 });
    expect(normalizeBrowserSteps([{ id: "a", op: "goto", url: "https://x.com", x: -5 }])?.[0].x).toBeUndefined();
  });
});

describe("canvas zoom + reset layout", () => {
  it("clampZoom bounds the scale and recovers from bad input", () => {
    expect(clampZoom(1.4)).toBe(1.4);
    expect(clampZoom(0.1)).toBe(0.5);
    expect(clampZoom(5)).toBe(2);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it("resetCanvasLayout strips node coordinates and keeps everything else", () => {
    const steps = [makeBrowserStep("goto", "a")];
    steps[0].x = 300;
    steps[0].y = 120;
    const reset = resetCanvasLayout(steps);
    expect(reset[0]).toMatchObject({ id: "a", op: "goto" });
    expect("x" in reset[0]).toBe(false);
    expect("y" in reset[0]).toBe(false);
    expect(reset).toHaveLength(1);
  });
});
