import { describe, it, expect } from "vitest";
import {
  LANGUAGES,
  MAX_CODE_LEN,
  MAX_CONSOLE_ENTRIES,
  appendEntries,
  clampTimeoutSec,
  formatElapsedSeconds,
  getOrCreateConversationId,
  isLanguageId,
  languageDef,
  makeEntry,
  normalizeCode,
  normalizeRunPayload,
  remainingMs,
  rotateConversationId,
  sanitizeLanguage,
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
