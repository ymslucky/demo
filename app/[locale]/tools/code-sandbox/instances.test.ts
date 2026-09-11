import { describe, expect, it } from "vitest";
import {
  filterInstances,
  formatRemainingMs,
  groupInstances,
  instanceStatus,
  parseDayRange,
  sortInstances,
  type InstanceFilter,
} from "./instances";
import type { SandboxInstanceRecord } from "./utils";

/** Unit coverage for the instances-domain pure logic (moved from utils.test.ts). */

describe("instance table helpers", () => {
  // Local noon keeps date-range assertions timezone-independent.
  const NOW = new Date(2026, 2, 15, 12).getTime();
  const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
  const record = (overrides: Partial<SandboxInstanceRecord>): SandboxInstanceRecord => ({
    instanceId: "i-1",
    uid: "user_1",
    createdAt: NOW - 60_000,
    updatedAt: NOW - 30_000,
    expiresAt: iso(120_000),
    ...overrides,
  });
  const records: SandboxInstanceRecord[] = [
    record({ instanceId: "i-beta", uid: "user_2", createdAt: NOW - 200_000, updatedAt: NOW - 90_000 }),
    record({ instanceId: "i-alpha", uid: "user_1", expiresAt: iso(-60_000) }),
    record({ instanceId: "i-gamma", uid: "user_1", expiresAt: undefined }),
  ];

  it("classifies alive / expired / unknown statuses", () => {
    expect(instanceStatus(records[0], NOW)).toBe("alive");
    expect(instanceStatus(records[1], NOW)).toBe("expired");
    expect(instanceStatus(records[2], NOW)).toBe("unknown");
  });

  it("parses day strings into inclusive local-time ranges", () => {
    const range = parseDayRange("2026-03-14", "2026-03-15");
    expect(range.from).toBe(new Date(2026, 2, 14).getTime());
    expect(range.to).toBe(new Date(2026, 2, 15).getTime() + 24 * 60 * 60 * 1000 - 1);
    expect(parseDayRange(undefined, "junk")).toEqual({ from: null, to: null });
  });

  it("filters by text, status and created-date range", () => {
    const none: InstanceFilter = {};
    expect(filterInstances(records, none, NOW)).toHaveLength(3);

    expect(filterInstances(records, { text: "ALPHA" }, NOW).map((r) => r.instanceId)).toEqual(["i-alpha"]);
    expect(filterInstances(records, { text: "user_2" }, NOW).map((r) => r.instanceId)).toEqual(["i-beta"]);
    expect(filterInstances(records, { status: "expired" }, NOW).map((r) => r.instanceId)).toEqual(["i-alpha"]);
    expect(filterInstances(records, { status: "unknown" }, NOW).map((r) => r.instanceId)).toEqual(["i-gamma"]);

    // Records created before today are excluded when the range starts today.
    const todayOnly: InstanceFilter = { createdFrom: "2026-03-15", createdTo: "2026-03-15" };
    const dayStart = new Date(2026, 2, 15).getTime();
    const inRange = records.filter((r) => r.createdAt >= dayStart);
    expect(filterInstances(records, todayOnly, NOW)).toEqual(inRange);
  });

  it("sorts by column without mutating the input; missing expiresAt always sinks", () => {
    const byId = sortInstances(records, "instanceId");
    expect(byId.map((r) => r.instanceId)).toEqual(["i-alpha", "i-beta", "i-gamma"]);
    expect(records.map((r) => r.instanceId)).toEqual(["i-beta", "i-alpha", "i-gamma"]);

    expect(sortInstances(records, "uid", "desc").map((r) => r.instanceId)).toEqual([
      "i-beta",
      "i-alpha",
      "i-gamma",
    ]);
    expect(sortInstances(records, "updatedAt").map((r) => r.instanceId)).toEqual([
      "i-beta",
      "i-alpha",
      "i-gamma",
    ]);
    expect(sortInstances(records, "expiresAt", "desc").map((r) => r.instanceId)).toEqual([
      "i-beta",
      "i-alpha",
      "i-gamma",
    ]);
  });

  it("groups by uid / status, preserving first-appearance order", () => {
    expect(groupInstances(records, "none", NOW)).toEqual([{ key: "", records }]);
    expect(groupInstances(records, "uid", NOW).map((g) => [g.key, g.records.length])).toEqual([
      ["user_2", 1],
      ["user_1", 2],
    ]);
    expect(groupInstances(records, "status", NOW).map((g) => g.key)).toEqual(["alive", "expired", "unknown"]);
  });

  it("formats remaining time compactly", () => {
    expect(formatRemainingMs(4 * 60_000 + 30_000)).toBe("4m 30s");
    expect(formatRemainingMs(45_000)).toBe("45s");
    expect(formatRemainingMs(999)).toBe("<1s");
    expect(formatRemainingMs(0)).toBe("0s");
    expect(formatRemainingMs(-5)).toBe("0s");
    expect(formatRemainingMs(NaN)).toBe("0s");
  });
});
