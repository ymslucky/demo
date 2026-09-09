import { describe, it, expect } from "vitest";
import {
  applyReorder,
  formatDateValue,
  formatDateTimeValue,
  groupSections,
  isOverdue,
  normalizeItem,
  normalizeItems,
  parseDateValue,
  parseDateTimeValue,
  statsSummary,
  trend7Days,
  type TodoItem,
} from "./utils";

/** 构造完整 TodoItem 的便捷工厂（缺省字段取安全默认值）。 */
const mk = (id: string, overrides: Partial<TodoItem> = {}): TodoItem => ({
  id,
  title: `t-${id}`,
  note: "",
  done: false,
  createdAt: 0,
  completedAt: 0,
  dueAt: 0,
  remindAt: 0,
  priority: 0,
  group: "",
  ...overrides,
});

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
      dueAt: 0,
      remindAt: 0,
      priority: 0,
      group: "",
    });
    expect(normalizeItem({ id: "b", title: "x", done: "yes", createdAt: "7" })).toEqual({
      id: "b",
      title: "x",
      note: "",
      done: false,
      createdAt: 7,
      completedAt: 0,
      dueAt: 0,
      remindAt: 0,
      priority: 0,
      group: "",
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

describe("四要素字段归一化（dueAt/remindAt/priority/group）", () => {
  it("时间戳非正数或非法回退 0，合法值保留", () => {
    const bad = normalizeItem({ id: "m", title: "t", dueAt: -5, remindAt: "oops" });
    expect(bad?.dueAt).toBe(0);
    expect(bad?.remindAt).toBe(0);
    const good = normalizeItem({ id: "n", title: "t", dueAt: 100, remindAt: 200 });
    expect(good?.dueAt).toBe(100);
    expect(good?.remindAt).toBe(200);
  });

  it("priority 取整并夹紧到 0..3，非法回退 0", () => {
    expect(normalizeItem({ id: "o", title: "t", priority: 2.7 })?.priority).toBe(2);
    expect(normalizeItem({ id: "p", title: "t", priority: 99 })?.priority).toBe(3);
    expect(normalizeItem({ id: "q", title: "t", priority: -1 })?.priority).toBe(0);
    expect(normalizeItem({ id: "r", title: "t", priority: "oops" })?.priority).toBe(0);
  });

  it("group 去首尾空白并截断，非字符串回退默认组", () => {
    expect(normalizeItem({ id: "s", title: "t", group: "  工作  " })?.group).toBe("工作");
    expect(normalizeItem({ id: "t", title: "t", group: "g".repeat(50) })?.group).toHaveLength(40);
    expect(normalizeItem({ id: "u", title: "t", group: 42 })?.group).toBe("");
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
      {
        id: "a",
        title: "first",
        note: "",
        done: false,
        createdAt: 1,
        completedAt: 0,
        dueAt: 0,
        remindAt: 0,
        priority: 0,
        group: "",
      },
      {
        id: "b",
        title: "second",
        note: "",
        done: true,
        createdAt: 2,
        completedAt: 2,
        dueAt: 0,
        remindAt: 0,
        priority: 0,
        group: "",
      },
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

describe("groupSections", () => {
  it("默认组置顶，命名组按首次出现顺序排列", () => {
    const sections = groupSections([
      mk("a", { group: "工作" }),
      mk("b"),
      mk("c", { group: "生活" }),
      mk("d", { group: "工作" }),
    ]);
    expect(sections.map((section) => section.name)).toEqual(["", "工作", "生活"]);
    expect(sections[0].items.map((item) => item.id)).toEqual(["b"]);
    expect(sections[1].items.map((item) => item.id)).toEqual(["a", "d"]);
    expect(sections[2].items.map((item) => item.id)).toEqual(["c"]);
  });

  it("空清单返回仅含默认组的单节", () => {
    expect(groupSections([])).toEqual([{ name: "", items: [] }]);
  });
});

describe("isOverdue", () => {
  const now = new Date(2026, 8, 9, 12, 0, 0).getTime();

  it("待办且截止整天（23:59:59.999）已过才算逾期", () => {
    expect(isOverdue(mk("a", { dueAt: new Date(2026, 8, 8, 9).getTime() }), now)).toBe(true);
    expect(isOverdue(mk("b", { dueAt: new Date(2026, 8, 9, 0, 1).getTime() }), now)).toBe(false);
    expect(
      isOverdue(mk("c", { dueAt: new Date(2026, 8, 9, 23, 59, 59, 999).getTime() }), now),
    ).toBe(false);
  });

  it("已完成或未设截止日的条目永不逾期", () => {
    expect(isOverdue(mk("d", { done: true, dueAt: new Date(2020, 0, 1).getTime() }), now)).toBe(
      false,
    );
    expect(isOverdue(mk("e"), now)).toBe(false);
  });
});

describe("日期表单值互转", () => {
  it("formatDateValue/formatDateTimeValue 输出本地 yyyy-mm-dd（-local 时间）", () => {
    expect(formatDateValue(0)).toBe("");
    expect(formatDateValue(new Date(2026, 8, 9, 14, 30).getTime())).toBe("2026-09-09");
    expect(formatDateTimeValue(0)).toBe("");
    expect(formatDateTimeValue(new Date(2026, 8, 9, 14, 30).getTime())).toBe("2026-09-09T14:30");
    expect(formatDateTimeValue(new Date(2026, 0, 2, 7, 5).getTime())).toBe("2026-01-02T07:05");
  });

  it("parseDateValue/parseDateTimeValue 解析本地值，非法回 0", () => {
    expect(parseDateValue("")).toBe(0);
    expect(parseDateValue("2026-09-09")).toBe(new Date(2026, 8, 9).getTime());
    expect(parseDateValue("junk")).toBe(0);
    expect(parseDateTimeValue("")).toBe(0);
    expect(parseDateTimeValue("2026-09-09T14:30")).toBe(new Date(2026, 8, 9, 14, 30).getTime());
    expect(parseDateTimeValue("junk")).toBe(0);
  });

  it("格式化后可无损往返", () => {
    const stamp = new Date(2026, 8, 9, 14, 30).getTime();
    expect(parseDateValue(formatDateValue(stamp))).toBe(new Date(2026, 8, 9).getTime());
    expect(parseDateTimeValue(formatDateTimeValue(stamp))).toBe(stamp);
  });
});

describe("applyReorder", () => {
  it("同组向下移动：目标索引按含拖拽项的列表测量", () => {
    // [A,B,C] 把 A 拖到渲染槽位 2（C 的位置）→ [B,A,C]
    expect(applyReorder([mk("a"), mk("b"), mk("c")], "a", "", 2)?.map((i) => i.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
    // 拖到最底部（槽位 3）→ [B,C,A]
    expect(applyReorder([mk("a"), mk("b"), mk("c")], "a", "", 3)?.map((i) => i.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("同组向上移动", () => {
    // [A,B,C] 把 C 拖到渲染槽位 0 → [C,A,B]
    expect(applyReorder([mk("a"), mk("b"), mk("c")], "c", "", 0)?.map((i) => i.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("拖到自己原槽位为无操作", () => {
    expect(applyReorder([mk("a"), mk("b")], "a", "", 0)?.map((i) => i.id)).toEqual(["a", "b"]);
    expect(applyReorder([mk("a"), mk("b")], "b", "", 1)?.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("跨组移动：插入目标组指定位置并改写 group", () => {
    const items = [mk("a", { group: "工作" }), mk("b", { group: "工作" }), mk("c")];
    const next = applyReorder(items, "c", "工作", 1);
    expect(next?.map((item) => item.id)).toEqual(["a", "c", "b"]);
    expect(next?.find((item) => item.id === "c")?.group).toBe("工作");
    // 移入空目标组（渲染槽位 0）
    const into = applyReorder([mk("a"), mk("b", { group: "工作" })], "a", "工作", 0);
    expect(into?.map((item) => item.id)).toEqual(["a", "b"]);
    expect(into?.[0].group).toBe("工作");
  });

  it("未知拖拽 id 返回 null，索引越界夹紧到组末尾", () => {
    expect(applyReorder([mk("a")], "zz", "", 0)).toBeNull();
    expect(applyReorder([mk("a"), mk("b")], "a", "", 99)?.map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("不修改原数组", () => {
    const items = [mk("a"), mk("b")];
    applyReorder(items, "a", "", 1);
    expect(items.map((item) => item.id)).toEqual(["a", "b"]);
  });
});

describe("statsSummary", () => {
  it("统计总数、完成数与待办数", () => {
    const items = [
      mk("a", { done: true, createdAt: 1, completedAt: 1 }),
      mk("b", { createdAt: 2 }),
      mk("c", { done: true, createdAt: 3, completedAt: 3 }),
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
      mk("a", { createdAt: at(9, 9, 8), completedAt: at(9, 9, 10), done: true }),
      mk("b", { createdAt: at(9, 8, 9) }),
      mk("c", { createdAt: at(9, 4, 9), completedAt: at(9, 8, 18), done: true }),
      mk("d", { createdAt: at(9, 1, 9), completedAt: at(9, 2, 9), done: true }),
      mk("e", { createdAt: at(9, 8, 9), done: true }),
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
    const items = [mk("a", { createdAt: at(8, 1, 9), completedAt: at(8, 2, 9), done: true })];
    expect(trend7Days(items, now)).toEqual(
      Array.from({ length: 7 }, () => ({ added: 0, completed: 0 })),
    );
    expect(trend7Days([], now)).toEqual(
      Array.from({ length: 7 }, () => ({ added: 0, completed: 0 })),
    );
  });
});
