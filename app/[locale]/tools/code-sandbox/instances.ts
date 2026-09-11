/**
 * Code Sandbox —— 实例列表域纯逻辑（InstancesPanel 的筛选 / 排序 / 分组 /
 * 状态判定，导出供单测）。
 *
 * 从 utils.ts 拆出（关注点分离）：本文件只关心“实例档案怎么筛/排/分组”，
 * 运行时类型 SandboxInstanceRecord 仍归 utils.ts。代码内容保持 CJK-free
 * （词表走 next-intl）；注释允许中文。
 */

import type { SandboxInstanceRecord } from "./utils";

export type InstanceStatus = "alive" | "expired" | "unknown";

/** 状态判定：到期时间可解析且未到 → alive；已过 → expired；缺失/非法 → unknown。 */
export function instanceStatus(record: SandboxInstanceRecord, now: number): InstanceStatus {
  if (!record.expiresAt) return "unknown";
  const time = Date.parse(record.expiresAt);
  if (!Number.isFinite(time)) return "unknown";
  return time > now ? "alive" : "expired";
}

/** 实例筛选条件（字段全部可选；date 值为 YYYY-MM-DD 字符串，含当日）。 */
export interface InstanceFilter {
  text?: string;
  status?: InstanceStatus | "all";
  createdFrom?: string;
  createdTo?: string;
}

/**
 * date 输入值 → 本地时区毫秒闭区间；空/非法返回 null（不限制）。
 * to 端补足到当日 23:59:59.999。
 */
export function parseDayRange(
  fromValue?: string,
  toValue?: string,
): { from: number | null; to: number | null } {
  const parseDay = (value?: string): number | null => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [y, m, d] = value.split("-").map(Number);
    const time = new Date(y, m - 1, d).getTime();
    return Number.isFinite(time) ? time : null;
  };
  const from = parseDay(fromValue);
  const toRaw = parseDay(toValue);
  const to = toRaw === null ? null : toRaw + 24 * 60 * 60 * 1000 - 1;
  return { from, to };
}

/** 本地筛选：文本匹配 instanceId/uid（大小写不敏感子串），状态精确，创建日期闭区间。 */
export function filterInstances(
  records: SandboxInstanceRecord[],
  filter: InstanceFilter,
  now: number,
): SandboxInstanceRecord[] {
  const text = filter.text?.trim().toLowerCase() ?? "";
  const range = parseDayRange(filter.createdFrom, filter.createdTo);
  return records.filter((record) => {
    if (
      text &&
      !record.instanceId.toLowerCase().includes(text) &&
      !record.uid.toLowerCase().includes(text)
    ) {
      return false;
    }
    if (filter.status && filter.status !== "all" && instanceStatus(record, now) !== filter.status) {
      return false;
    }
    if (range.from !== null && record.createdAt < range.from) return false;
    if (range.to !== null && record.createdAt > range.to) return false;
    return true;
  });
}

export type InstanceSortKey = "instanceId" | "uid" | "createdAt" | "updatedAt" | "expiresAt";
export type SortDirection = "asc" | "desc";

/**
 * 排序（不修改入参）：字符串列 localeCompare，时间列数值比较；expiresAt
 * 缺失/非法的记录恒排最后（与方向无关），便于一眼找出残缺档案。
 */
export function sortInstances(
  records: SandboxInstanceRecord[],
  key: InstanceSortKey,
  dir: SortDirection = "asc",
): SandboxInstanceRecord[] {
  const factor = dir === "desc" ? -1 : 1;
  return [...records].sort((a, b) => {
    if (key === "instanceId" || key === "uid") return a[key].localeCompare(b[key]) * factor;
    if (key === "createdAt" || key === "updatedAt") return (a[key] - b[key]) * factor;
    const av = a.expiresAt ? Date.parse(a.expiresAt) : NaN;
    const bv = b.expiresAt ? Date.parse(b.expiresAt) : NaN;
    if (Number.isNaN(av) && Number.isNaN(bv)) return 0;
    if (Number.isNaN(av)) return 1;
    if (Number.isNaN(bv)) return -1;
    return (av - bv) * factor;
  });
}

export type InstanceGroupKey = "none" | "uid" | "status";

export interface InstanceGroup {
  /** 组标识：uid 组为用户 ID，status 组为状态枚举值，none 为空字符串。 */
  key: string;
  records: SandboxInstanceRecord[];
}

/** 分组（组内保持传入顺序，组按首次出现顺序）；none 返回单组。 */
export function groupInstances(
  records: SandboxInstanceRecord[],
  key: InstanceGroupKey,
  now: number,
): InstanceGroup[] {
  if (key === "none") return [{ key: "", records }];
  const groups = new Map<string, SandboxInstanceRecord[]>();
  for (const record of records) {
    const groupKey = key === "uid" ? record.uid : instanceStatus(record, now);
    const bucket = groups.get(groupKey);
    if (bucket) bucket.push(record);
    else groups.set(groupKey, [record]);
  }
  return [...groups.entries()].map(([groupKey, rs]) => ({ key: groupKey, records: rs }));
}

/** 剩余寿命展示："4m 30s"、"45s"、不足 1s 为 "<1s"、非正数为 "0s"。 */
export function formatRemainingMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  if (ms < 1000) return "<1s";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
