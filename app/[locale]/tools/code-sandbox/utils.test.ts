import { describe, it, expect } from "vitest";
import {
  LANGUAGES,
  LIFETIME_CHOICES_MIN,
  MAX_CODE_LEN,
  MAX_CONSOLE_ENTRIES,
  MAX_RUN_HISTORY,
  appendEntries,
  appendRuns,
  clampTimeoutSec,
  filterInstances,
  formatClock,
  formatDateTime,
  formatElapsedSeconds,
  formatRemainingMs,
  getOrCreateConversationId,
  groupInstances,
  instanceStatus,
  isLanguageId,
  languageDef,
  makeEntry,
  normalizeCode,
  normalizeInstanceRecords,
  normalizeRunPayload,
  parseDayRange,
  remainingMs,
  rotateConversationId,
  sanitizeLanguage,
  sortInstances,
  type InstanceFilter,
  type SandboxInstanceRecord,
  type RunRecord,
  type StorageLike,
} from "./utils";

function fakeStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe("sanitizeLanguage", () => {
  it("accepts known language ids", () => {
    for (const lang of LANGUAGES) {
      expect(sanitizeLanguage(lang.id, "python")).toBe(lang.id);
    }
  });

  it("falls back on unknown or missing values", () => {
    expect(sanitizeLanguage("ruby", "bash")).toBe("bash");
    expect(sanitizeLanguage(undefined, "go")).toBe("go");
    expect(sanitizeLanguage(null, "java")).toBe("java");
  });
});

describe("isLanguageId and languageDef", () => {
  it("narrows only whitelisted ids", () => {
    expect(isLanguageId("python")).toBe(true);
    expect(isLanguageId("ruby")).toBe(false);
  });

  it("returns a def for every language", () => {
    expect(languageDef("python").runtime).toBe("kernel");
    expect(languageDef("javascript").runtime).toBe("kernel");
    expect(languageDef("bash").runtime).toBe("shell");
    expect(languageDef("go").runtime).toBe("toolchain");
    expect(languageDef("java").runtime).toBe("toolchain");
  });
});

describe("clampTimeoutSec", () => {
  it("clamps into [5, 60]", () => {
    expect(clampTimeoutSec(1)).toBe(5);
    expect(clampTimeoutSec(999)).toBe(60);
    expect(clampTimeoutSec(15.6)).toBe(16);
  });

  it("falls back to the default on non-numeric input", () => {
    expect(clampTimeoutSec("30")).toBe(30);
    expect(clampTimeoutSec(NaN)).toBe(30);
    expect(clampTimeoutSec(undefined)).toBe(30);
  });
});

describe("normalizeCode", () => {
  it("passes through short code", () => {
    expect(normalizeCode("print(1)")).toBe("print(1)");
    expect(normalizeCode(42)).toBe("");
  });

  it("truncates overlong code to MAX_CODE_LEN", () => {
    const long = "a".repeat(MAX_CODE_LEN + 10);
    expect(normalizeCode(long).length).toBe(MAX_CODE_LEN);
  });
});

describe("conversation id storage", () => {
  it("reuses an existing id", () => {
    const store = fakeStorage({ conv: "abc" });
    const calls: string[] = [];
    const id = getOrCreateConversationId(store, "conv", () => {
      calls.push("created");
      return "new";
    });
    expect(id).toBe("abc");
    expect(calls).toHaveLength(0);
  });

  it("creates and persists when missing", () => {
    const store = fakeStorage();
    const id = getOrCreateConversationId(store, "conv", () => "fresh");
    expect(id).toBe("fresh");
    expect(store.data.conv).toBe("fresh");
  });

  it("rotate always replaces", () => {
    const store = fakeStorage({ conv: "old" });
    let counter = 0;
    const id = rotateConversationId(store, "conv", () => `n${(counter += 1)}`);
    expect(id).toBe("n1");
    expect(store.data.conv).toBe("n1");
  });
});

describe("normalizeRunPayload", () => {
  it("parses a well-formed run response", () => {
    const payload = normalizeRunPayload({
      ok: true,
      language: "python",
      stdout: "1\n2\n",
      stderr: "",
      results: ["42"],
      error: "",
      exitCode: 0,
      elapsedMs: 1234,
      sandbox: { instanceId: "i-1", expiresAt: "2026-01-01T00:00:00Z", externalUrl: "https://x" },
    });
    expect(payload).not.toBeNull();
    expect(payload?.ok).toBe(true);
    expect(payload?.outcome.exitCode).toBe(0);
    expect(payload?.outcome.results).toEqual(["42"]);
    expect(payload?.sandbox.instanceId).toBe("i-1");
  });

  it("coerces malformed fields instead of throwing", () => {
    const payload = normalizeRunPayload({ ok: false, error: "sandbox-error" });
    expect(payload?.ok).toBe(false);
    expect(payload?.outcome.exitCode).toBe(1);
    expect(payload?.outcome.error).toBe("sandbox-error");
    expect(payload?.outcome.results).toEqual([]);
    expect(payload?.sandbox.instanceId).toBeUndefined();
  });

  it("never lets Number(null) mask a failure as exit code 0", () => {
    const payload = normalizeRunPayload({ ok: false, exitCode: null });
    expect(payload?.outcome.exitCode).toBe(1);
    const okPayload = normalizeRunPayload({ ok: true, exitCode: null });
    expect(okPayload?.outcome.exitCode).toBe(0);
  });

  it("returns null for non-object input", () => {
    expect(normalizeRunPayload(null)).toBeNull();
    expect(normalizeRunPayload("nope")).toBeNull();
  });
});

describe("remainingMs and formatElapsedSeconds", () => {
  it("computes non-negative remaining time", () => {
    const future = new Date("2026-01-01T00:10:00Z").toISOString();
    const now = Date.parse("2026-01-01T00:05:00Z");
    expect(remainingMs(future, now)).toBe(5 * 60 * 1000);
    expect(remainingMs(future, now + 10 * 60 * 1000)).toBe(0);
  });

  it("returns null for empty or unparsable input", () => {
    expect(remainingMs(undefined, 0)).toBeNull();
    expect(remainingMs("not-a-date", 0)).toBeNull();
  });

  it("formats elapsed time with two decimals", () => {
    expect(formatElapsedSeconds(0)).toBe("0.00");
    expect(formatElapsedSeconds(1234)).toBe("1.23");
  });
});

describe("console entries", () => {
  it("caps the list at MAX_CONSOLE_ENTRIES", () => {
    let list = [] as ReturnType<typeof makeEntry>[];
    for (let i = 0; i < MAX_CONSOLE_ENTRIES + 50; i += 1) {
      list = appendEntries(list, [makeEntry("stdout", `line ${i}`, i)]);
    }
    expect(list.length).toBe(MAX_CONSOLE_ENTRIES);
    expect(list[list.length - 1].text).toBe(`line ${MAX_CONSOLE_ENTRIES + 49}`);
  });

  it("keeps the newest entries when trimming", () => {
    const list = [makeEntry("stdout", "a", 1), makeEntry("stdout", "b", 2)];
    const merged = appendEntries(list, [makeEntry("stdout", "c", 3)]);
    expect(merged.map((entry) => entry.text)).toEqual(["a", "b", "c"]);
  });
});

describe("run history", () => {
  function makeRun(id: string): RunRecord {
    return {
      id,
      language: "python",
      at: 1000,
      ok: true,
      elapsedMs: 100,
      exitCode: 0,
      code: "print('x')",
      output: [],
    };
  }

  it("inserts the newest run at the front", () => {
    const merged = appendRuns([makeRun("a")], makeRun("b"));
    expect(merged.map((run) => run.id)).toEqual(["b", "a"]);
  });

  it("caps the list at MAX_RUN_HISTORY", () => {
    let list: RunRecord[] = [];
    for (let i = 0; i < MAX_RUN_HISTORY + 5; i += 1) {
      list = appendRuns(list, makeRun(`r${i}`));
    }
    expect(list.length).toBe(MAX_RUN_HISTORY);
    expect(list[0].id).toBe(`r${MAX_RUN_HISTORY + 4}`);
    expect(list[MAX_RUN_HISTORY - 1].id).toBe("r5");
  });
});

describe("formatClock", () => {
  it("formats a local timestamp as zero-padded HH:MM:SS", () => {
    expect(formatClock(new Date(2026, 0, 2, 3, 4, 5).getTime())).toBe("03:04:05");
    expect(formatClock(new Date(2026, 10, 2, 13, 45, 59).getTime())).toBe("13:45:59");
  });
});

describe("formatDateTime", () => {
  it("formats a local timestamp as YYYY-MM-DD HH:MM:SS", () => {
    const ts = new Date(2026, 0, 2, 3, 4, 5).getTime();
    expect(formatDateTime(ts)).toBe("2026-01-02 03:04:05");
    expect(formatDateTime(new Date(2026, 10, 12, 13, 45, 59).getTime())).toBe("2026-11-12 13:45:59");
  });

  it("returns a placeholder for invalid or missing timestamps", () => {
    expect(formatDateTime(NaN)).toBe("—");
    expect(formatDateTime(0)).toBe("—");
    expect(formatDateTime(-5)).toBe("—");
  });
});

describe("lifetime choices", () => {
  it("offer 1-10 minute presets with a 1-minute default shape", () => {
    expect(LIFETIME_CHOICES_MIN[0]).toBe(1);
    expect(LIFETIME_CHOICES_MIN[LIFETIME_CHOICES_MIN.length - 1]).toBe(10);
    expect([...LIFETIME_CHOICES_MIN]).toEqual([...new Set(LIFETIME_CHOICES_MIN)].sort((a, b) => a - b));
  });
});

describe("normalizeInstanceRecords", () => {
  it("parses a well-formed list response and coerces numeric fields", () => {
    const records = normalizeInstanceRecords({
      sandboxes: [
        {
          instanceId: "i-abc-123",
          uid: "user_1",
          createdAt: 1000,
          updatedAt: 2000,
          expiresAt: "2026-01-01T00:10:00Z",
          externalUrl: "https://x.example.com",
        },
        { instanceId: "i-2", uid: "user_2" },
      ],
    });
    expect(records).not.toBeNull();
    expect(records).toHaveLength(2);
    expect(records?.[0]).toEqual({
      instanceId: "i-abc-123",
      uid: "user_1",
      createdAt: 1000,
      updatedAt: 2000,
      expiresAt: "2026-01-01T00:10:00Z",
      externalUrl: "https://x.example.com",
    });
    // Missing optional fields stay undefined; malformed numerics fall back to 0.
    expect(records?.[1]).toEqual({
      instanceId: "i-2",
      uid: "user_2",
      createdAt: 0,
      updatedAt: 0,
      expiresAt: undefined,
      externalUrl: undefined,
    });
  });

  it("drops entries without instanceId or uid and returns null for non-list input", () => {
    const records = normalizeInstanceRecords({
      sandboxes: [{ instanceId: "", uid: "u" }, { instanceId: "i", uid: "" }, "junk", null],
    });
    expect(records).toEqual([]);

    expect(normalizeInstanceRecords(null)).toBeNull();
    expect(normalizeInstanceRecords("nope")).toBeNull();
    expect(normalizeInstanceRecords({})).toBeNull();
    expect(normalizeInstanceRecords({ sandboxes: "not-an-array" })).toBeNull();
  });
});

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
