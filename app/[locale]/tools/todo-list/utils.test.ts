import { describe, it, expect } from "vitest";
import { normalizeItem, normalizeItems, statsSummary } from "./utils";

describe("normalizeItem", () => {
  it("保留合法条目并归一化字段", () => {
    expect(
      normalizeItem({ id: "a", title: "买牛奶", note: "两盒", done: true, createdAt: 42 }),
    ).toEqual({
      id: "a",
      title: "买牛奶",
      note: "两盒",
      done: true,
      createdAt: 42,
    });
    expect(normalizeItem({ id: "b", title: "x", done: "yes", createdAt: "7" })).toEqual({
      id: "b",
      title: "x",
      note: "",
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

  it("note 缺失或非法回退空串，超长截断", () => {
    expect(normalizeItem({ id: "f", title: "t", note: 42 })?.note).toBe("");
    expect(normalizeItem({ id: "g", title: "t", note: "  hi  " })?.note).toBe("hi");
    expect(normalizeItem({ id: "h", title: "t", note: "x".repeat(3000) })?.note).toHaveLength(2000);
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
      { id: "a", title: "first", note: "", done: false, createdAt: 1 },
      { id: "b", title: "second", note: "", done: true, createdAt: 2 },
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

describe("statsSummary", () => {
  it("统计总数、完成数与待办数", () => {
    const items = [
      { id: "a", title: "t1", note: "", done: true, createdAt: 1 },
      { id: "b", title: "t2", note: "", done: false, createdAt: 2 },
      { id: "c", title: "t3", note: "", done: true, createdAt: 3 },
    ];
    expect(statsSummary(items)).toEqual({ total: 3, done: 2, pending: 1 });
  });

  it("空清单全为 0", () => {
    expect(statsSummary([])).toEqual({ total: 0, done: 0, pending: 0 });
  });
});
