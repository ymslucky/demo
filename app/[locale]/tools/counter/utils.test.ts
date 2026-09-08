import { describe, it, expect } from "vitest";
import { normalizeCount, normalizeSnapshot } from "./utils";

describe("normalizeCount", () => {
  it("保留合法的非负整数", () => {
    expect(normalizeCount(7)).toBe(7);
    expect(normalizeCount("42")).toBe(42);
    expect(normalizeCount(0)).toBe(0);
  });

  it("小数向下取整", () => {
    expect(normalizeCount(9.9)).toBe(9);
  });

  it("非法输入一律回退 0", () => {
    expect(normalizeCount(-1)).toBe(0);
    expect(normalizeCount("abc")).toBe(0);
    expect(normalizeCount(null)).toBe(0);
    expect(normalizeCount(undefined)).toBe(0);
    expect(normalizeCount(Infinity)).toBe(0);
  });
});

describe("normalizeSnapshot", () => {
  it("归一化完整载荷", () => {
    expect(normalizeSnapshot({ total: "8", users: 2, mine: 3 })).toEqual({
      total: 8,
      users: 2,
      mine: 3,
    });
  });

  it("users 缺失时回退 0", () => {
    expect(normalizeSnapshot({ total: 1, mine: 1 })).toEqual({
      total: 1,
      users: 0,
      mine: 1,
    });
  });

  it("结构不合法时返回 null", () => {
    expect(normalizeSnapshot(null)).toBeNull();
    expect(normalizeSnapshot("nope")).toBeNull();
    expect(normalizeSnapshot({})).toBeNull();
    expect(normalizeSnapshot({ users: 1 })).toBeNull(); // 缺 total/mine
  });
});
