import { afterEach, describe, expect, it, vi } from "vitest";
import {
  THEME_STORAGE_KEY,
  applyTheme,
  clearSavedTheme,
  getSavedTheme,
  isTheme,
  nextTheme,
  persistTheme,
  readCurrentTheme,
  resolveTheme,
  shouldFollowSystem,
  systemPrefersDark,
  themeInitScript,
  type Theme,
} from "../app/lib/theme";

// ---------------------------------------------------------------------------
// 纯逻辑: resolveTheme / nextTheme / shouldFollowSystem / isTheme
// ---------------------------------------------------------------------------

describe("resolveTheme", () => {
  it("manual stored preference wins over system", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("follows system dark when no stored preference", () => {
    expect(resolveTheme(null, true)).toBe("dark");
  });

  it("follows system light when no stored preference", () => {
    expect(resolveTheme(null, false)).toBe("light");
  });

  it("falls back to system when stored value is invalid", () => {
    expect(resolveTheme("neon", true)).toBe("dark");
    expect(resolveTheme("neon", false)).toBe("light");
    expect(resolveTheme("", true)).toBe("dark");
  });
});

describe("nextTheme", () => {
  it("toggles between light and dark", () => {
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("light");
  });
});

describe("shouldFollowSystem", () => {
  it("true when no manual override", () => {
    expect(shouldFollowSystem(null)).toBe(true);
  });

  it("false when manual override exists", () => {
    expect(shouldFollowSystem("light")).toBe(false);
    expect(shouldFollowSystem("dark")).toBe(false);
  });

  it("true for invalid stored values", () => {
    expect(shouldFollowSystem("neon")).toBe(true);
  });
});

describe("isTheme", () => {
  it("accepts only light/dark", () => {
    expect(isTheme("light")).toBe(true);
    expect(isTheme("dark")).toBe(true);
    expect(isTheme("neon")).toBe(false);
    expect(isTheme(null)).toBe(false);
    expect(isTheme(undefined)).toBe(false);
    expect(isTheme(42)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 首帧初始化脚本: 在伪造 DOM/存储/系统偏好的环境中执行
// ---------------------------------------------------------------------------

interface FakeEnv {
  stored: string | null;
  systemDark: boolean;
  storageThrows?: boolean;
  matchMediaMissing?: boolean;
}

function runInitScript(env: FakeEnv): Record<string, string> {
  const attrs: Record<string, string> = {};
  const fakeDocument = {
    documentElement: {
      setAttribute: (name: string, value: string) => {
        attrs[name] = value;
      },
    },
  };
  const fakeStorage = {
    getItem: () => {
      if (env.storageThrows) throw new Error("SecurityError");
      return env.stored;
    },
  };
  const fakeWindow = {
    matchMedia: env.matchMediaMissing
      ? undefined
      : (query: string) => ({
          matches: query === "(prefers-color-scheme: dark)" && env.systemDark,
        }),
  };

  // 脚本是自包含 ES5 字符串，用 Function 构造器在隔离作用域执行
  const run = new Function(
    "document",
    "localStorage",
    "window",
    themeInitScript(),
  );
  run(fakeDocument, fakeStorage, fakeWindow);
  return attrs;
}

describe("themeInitScript (FOUC prevention)", () => {
  it("applies stored dark preference even when system is light", () => {
    const attrs = runInitScript({ stored: "dark", systemDark: false });
    expect(attrs["data-theme"]).toBe("dark");
  });

  it("applies stored light preference even when system is dark", () => {
    const attrs = runInitScript({ stored: "light", systemDark: true });
    expect(attrs["data-theme"]).toBe("light");
  });

  it("follows system dark when no stored preference", () => {
    const attrs = runInitScript({ stored: null, systemDark: true });
    expect(attrs["data-theme"]).toBe("dark");
  });

  it("follows system light when no stored preference", () => {
    const attrs = runInitScript({ stored: null, systemDark: false });
    expect(attrs["data-theme"]).toBe("light");
  });

  it("falls back to system when storage is unavailable", () => {
    const attrs = runInitScript({
      stored: "dark",
      systemDark: true,
      storageThrows: true,
    });
    expect(attrs["data-theme"]).toBe("dark");
  });

  it("defaults to light when matchMedia is unavailable", () => {
    const attrs = runInitScript({
      stored: null,
      systemDark: true,
      matchMediaMissing: true,
    });
    expect(attrs["data-theme"]).toBe("light");
  });

  it("script is self-contained and references the right storage key", () => {
    const script = themeInitScript();
    expect(script).toContain(THEME_STORAGE_KEY);
    expect(script).toContain("data-theme");
    // 不得依赖任何外部导入/模块
    expect(script).not.toContain("import ");
    expect(script).not.toContain("require(");
  });
});

// ---------------------------------------------------------------------------
// DOM/存储辅助函数: 用假 localStorage 全局验证读写与清除
// ---------------------------------------------------------------------------

function installFakeStorage(initial: Record<string, string>) {
  const map = new Map(Object.entries(initial));
  const storage = {
    getItem: vi.fn((key: string) => (map.has(key) ? map.get(key)! : null)),
    setItem: vi.fn((key: string, value: string) => void map.set(key, value)),
    removeItem: vi.fn((key: string) => void map.delete(key)),
    clear: vi.fn(() => void map.clear()),
  };
  vi.stubGlobal("localStorage", storage);
  return storage;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getSavedTheme / persistTheme / clearSavedTheme", () => {
  it("reads a valid saved theme", () => {
    installFakeStorage({ [THEME_STORAGE_KEY]: "dark" });
    expect(getSavedTheme()).toBe("dark");
  });

  it("returns null when nothing saved", () => {
    installFakeStorage({});
    expect(getSavedTheme()).toBeNull();
  });

  it("returns null for an invalid saved value", () => {
    installFakeStorage({ [THEME_STORAGE_KEY]: "neon" });
    expect(getSavedTheme()).toBeNull();
  });

  it("persists then clears a theme", () => {
    const storage = installFakeStorage({});
    persistTheme("dark");
    expect(storage.setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, "dark");
    expect(getSavedTheme()).toBe("dark");
    clearSavedTheme();
    expect(storage.removeItem).toHaveBeenCalledWith(THEME_STORAGE_KEY);
    expect(getSavedTheme()).toBeNull();
  });

  it("is SSR-safe when localStorage is undefined", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(getSavedTheme()).toBeNull();
    expect(() => persistTheme("light")).not.toThrow();
    expect(() => clearSavedTheme()).not.toThrow();
    expect(() => applyTheme("dark")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// DOM 辅助: applyTheme / readCurrentTheme / systemPrefersDark (伪造 document)
// ---------------------------------------------------------------------------

describe("applyTheme / readCurrentTheme / systemPrefersDark", () => {
  it("applyTheme sets the data-theme attribute on documentElement", () => {
    const attrs: Record<string, string> = {};
    vi.stubGlobal("document", {
      documentElement: {
        setAttribute: (name: string, value: string) => {
          attrs[name] = value;
        },
        getAttribute: (name: string) => attrs[name] ?? null,
      },
    });
    applyTheme("dark");
    expect(attrs["data-theme"]).toBe("dark");
    expect(readCurrentTheme()).toBe("dark");
  });

  it("readCurrentTheme falls back to system preference when no attribute", () => {
    vi.stubGlobal("document", {
      documentElement: {
        setAttribute: () => {},
        getAttribute: () => null,
      },
    });
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: true }),
    });
    expect(readCurrentTheme()).toBe("dark");
    expect(systemPrefersDark()).toBe(true);
  });

  it("readCurrentTheme defaults to light when nothing is available", () => {
    vi.stubGlobal("document", {
      documentElement: {
        setAttribute: () => {},
        getAttribute: () => null,
      },
    });
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: false }),
    });
    expect(readCurrentTheme()).toBe("light");
  });

  it("is SSR-safe when document is undefined", () => {
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("window", undefined);
    expect(() => applyTheme("dark")).not.toThrow();
    expect(readCurrentTheme()).toBe("light");
    expect(systemPrefersDark()).toBe(false);
  });
});
