import { describe, it, expect } from "vitest";
import { normalizeItem, normalizeItems, statsSummary, trend7Days } from "./utils";

describe("normalizeItem", () => {
  it("保留合法条目并归一化字段", () => {
    expect(
      normalizeItem({
        id: "a",
        title: "买牛奶",
        note: "两盒",
        done: true,
        createdAt: 42,
        completedAt: 99,
      }),
    ).toEqual({
      id: "a",
      title: "买牛奶",
      note: "两盒",
      done: true,
      createdAt: 42,
      completedAt: 99,
    });
    expect(normalizeItem({ id: "b", title: "x", done: "yes", createdAt: "7" })).toEqual({
      id: "b",
      title: "x",
      note: "",
      done: false,
      createdAt: 7,
      completedAt: 0,
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

  it("completedAt：未完成为 0；已完成缺省回退 createdAt", () => {
    expect(normalizeItem({ id: "i", title: "t" })?.completedAt).toBe(0);
    expect(normalizeItem({ id: "j", title: "t", done: true, createdAt: 42 })?.completedAt).toBe(42);
    expect(
      normalizeItem({ id: "k", title: "t", done: true, createdAt: 42, completedAt: 99 })
        ?.completedAt,
    ).toBe(99);
    expect(
      normalizeItem({ id: "l", title: "t", done: true, completedAt: "oops" })?.completedAt,
    ).toBe(0);
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
      { id: "a", title: "first", note: "", done: false, createdAt: 1, completedAt: 0 },
      { id: "b", title: "second", note: "", done: true, createdAt: 2, completedAt: 2 },
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
      { id: "a", title: "t1", note: "", done: true, createdAt: 1, completedAt: 1 },
      { id: "b", title: "t2", note: "", done: false, createdAt: 2, completedAt: 0 },
      { id: "c", title: "t3", note: "", done: true, createdAt: 3, completedAt: 3 },
    ];
    expect(statsSummary(items)).toEqual({ total: 3, done: 2, pending: 1 });
  });

  it("空清单全为 0", () => {
    expect(statsSummary([])).toEqual({ total: 0, done: 0, pending: 0 });
  });
});

describe("trend7Days", () => {
  // 固定“今天”为 2026-09-09 12:00（本地时区），避免用例随时间漂移。
  const now = new Date(2026, 8, 9, 12, 0, 0).getTime();
  const at = (month: number, day: number, hour: number) =>
    new Date(2026, month - 1, day, hour).getTime();

  it("按本地日历日分桶：新增计 createdAt、完成计 completedAt", () => {
    const items = [
      { id: "a", title: "t", note: "", done: true, createdAt: at(9, 9, 8), completedAt: at(9, 9, 10) },
      { id: "b", title: "t", note: "", done: false, createdAt: at(9, 8, 9), completedAt: 0 },
      { id: "c", title: "t", note: "", done: true, createdAt: at(9, 4, 9), completedAt: at(9, 8, 18) },
      { id: "d", title: "t", note: "", done: true, createdAt: at(9, 1, 9), completedAt: at(9, 2, 9) },
      { id: "e", title: "t", note: "", done: true, createdAt: at(9, 8, 9), completedAt: 0 },
    ];
    expect(trend7Days(items, now)).toEqual([
      { added: 0, completed: 0 }, // 09-03
      { added: 1, completed: 0 }, // 09-04（c 新增）
      { added: 0, completed: 0 }, // 09-05
      { added: 0, completed: 0 }, // 09-06
      { added: 0, completed: 0 }, // 09-07
      { added: 2, completed: 1 }, // 09-08（b、e 新增；c 完成）
      { added: 1, completed: 1 }, // 09-09（今天）
    ]);
  });

  it("超出窗口的时间戳被忽略，空清单全 0", () => {
    const items = [
      { id: "a", title: "t", note: "", done: true, createdAt: at(8, 1, 9), completedAt: at(8, 2, 9) },
    ];
    expect(trend7Days(items, now)).toEqual(
      Array.from({ length: 7 }, () => ({ added: 0, completed: 0 })),
    );
    expect(trend7Days([], now)).toEqual(
      Array.from({ length: 7 }, () => ({ added: 0, completed: 0 })),
    );
  });
});
