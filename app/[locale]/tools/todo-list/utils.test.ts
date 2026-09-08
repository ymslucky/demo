import { describe, it, expect } from "vitest";
import { normalizeItem, normalizeItems } from "./utils";

describe("normalizeItem", () => {
  it("保留合法条目并归一化字段", () => {
    expect(normalizeItem({ id: "a", title: "买牛奶", done: true, createdAt: 42 })).toEqual({
      id: "a",
      title: "买牛奶",
      done: true,
      createdAt: 42,
    });
    expect(normalizeItem({ id: "b", title: "x", done: "yes", createdAt: "7" })).toEqual({
      id: "b",
      title: "x",
      done: false,
      createdAt: 7,
    });
  });

  it("缺 id 或标题为空的条目返回 null", () => {
    expect(normalizeItem({ title: "no-id" })).toBeNull();
    expect(normalizeItem({ id: "c", title: "   " })).toBeNull();
    expect(normalizeItem(null)).toBeNull();
    expect(normalizeItem("junk")).toBeNull();
    expect(normalizeItem(undefined)).toBeNull();
  });

  it("createdAt 非法时回退 0", () => {
    expect(normalizeItem({ id: "d", title: "t", createdAt: "oops" })?.createdAt).toBe(0);
    expect(normalizeItem({ id: "e", title: "t" })?.createdAt).toBe(0);
  });
});

describe("normalizeItems", () => {
  it("归一化完整载荷并丢弃垃圾条目", () => {
    expect(
      normalizeItems({
        items: [
          { id: "a", title: "first", done: false, createdAt: 1 },
          "junk",
          { title: "missing-id" },
          { id: "b", title: "second", done: true, createdAt: 2 },
        ],
      }),
    ).toEqual([
      { id: "a", title: "first", done: false, createdAt: 1 },
      { id: "b", title: "second", done: true, createdAt: 2 },
    ]);
  });

  it("结构不合法时返回 null", () => {
    expect(normalizeItems(null)).toBeNull();
    expect(normalizeItems("nope")).toBeNull();
    expect(normalizeItems({})).toBeNull();
    expect(normalizeItems({ items: "not-an-array" })).toBeNull();
  });

  it("空数组是合法载荷", () => {
    expect(normalizeItems({ items: [] })).toEqual([]);
  });
});
