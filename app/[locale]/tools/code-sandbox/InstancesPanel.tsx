"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "../../components/ui";
import {
  cardStyle as cardBaseStyle,
  monoStyle,
  mutedStyle,
  tdStyle,
  thStyle,
} from "@/app/lib/styles";
import {
  filterInstances,
  formatRemainingMs,
  groupInstances,
  instanceStatus,
  sortInstances,
  type InstanceGroupKey,
  type InstanceSortKey,
  type InstanceStatus,
  type SortDirection,
} from "./instances";
import { formatDateTime, remainingMs, type SandboxInstanceRecord } from "./utils";

/**
 * 实例列表子页：Neo-Brutalism 表格组件，纯前端本地筛选（文本 / 状态 /
 * 创建日期区间）/ 排序（点击列头）/ 分组（按用户或状态）。筛选排序等
 * 纯逻辑在 instances.ts（含单测），本组件只负责展示与交互。
 */

// 与工作台卡片同族的表格外壳（基础卡 + 列表变体：通栏 + 可拉高时行不随
// stretch 撑开——历史 BUG：标题块被 auto 行拉伸导致高度失控）。
const panelStyle = {
  ...cardBaseStyle,
  display: "grid",
  gap: "var(--space-sm)",
  alignContent: "start",
  gridColumn: "1 / -1",
  minHeight: 0,
} as const;

// 工具条输入控件：fontFamily 必须 inherit（原生 input/select 不继承字体）。
const controlStyle = {
  fontFamily: "inherit",
  fontSize: "var(--fs-sm)",
  padding: "0.35rem 0.5rem",
  border: "3px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
} as const;

const statusBadgeStyle = (kind: InstanceStatus) => {
  const palette =
    kind === "alive"
      ? { bg: "var(--color-info-bg)", fg: "var(--color-info-text)" }
      : kind === "expired"
        ? { bg: "var(--color-err-bg)", fg: "var(--color-err-text)" }
        : { bg: "var(--color-tag-bg)", fg: "var(--color-tag-text)" };
  return {
    display: "inline-block",
    border: "2px solid var(--color-border)",
    borderRadius: "var(--radius-sm)",
    padding: "0.1rem 0.5rem",
    fontSize: "var(--fs-xs)",
    fontWeight: 800,
    background: palette.bg,
    color: palette.fg,
    whiteSpace: "nowrap",
  } as const;
};

const tableWrapperStyle = {
  overflowX: "auto" as const,
  border: "3px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
} as const;

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse" as const,
  fontSize: "var(--fs-sm)",
  fontFamily: "var(--font-mono)",
  minWidth: 920,
};

// 列头排序按钮：重置 UA 样式，继承 th 字体。
const thButtonStyle = {
  fontFamily: "inherit",
  fontSize: "inherit",
  fontWeight: 800,
  border: "none",
  background: "none",
  color: "inherit",
  cursor: "pointer",
  padding: 0,
  display: "inline-flex",
  alignItems: "center",
  gap: "0.3rem",
} as const;

/** 外部地址短展示：去协议、超长截断（完整地址见 title 与链接本身）。 */
function shortUrl(url: string): string {
  const bare = url.replace(/^https?:\/\//, "");
  return bare.length > 42 ? `${bare.slice(0, 41)}…` : bare;
}

type InstancesPanelProps = {
  records: SandboxInstanceRecord[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  now: number;
};

export default function InstancesPanel({ records, loading, error, onRefresh, now }: InstancesPanelProps) {
  const t = useTranslations("tools.sandbox");
  const [text, setText] = useState("");
  const [status, setStatus] = useState<InstanceStatus | "all">("all");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [group, setGroup] = useState<InstanceGroupKey>("none");
  const [sortKey, setSortKey] = useState<InstanceSortKey>("updatedAt");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");

  const filtered = useMemo(
    () => filterInstances(records, { text, status, createdFrom, createdTo }, now),
    [records, text, status, createdFrom, createdTo, now],
  );
  const sorted = useMemo(() => sortInstances(filtered, sortKey, sortDir), [filtered, sortKey, sortDir]);
  const groups = useMemo(() => groupInstances(sorted, group, now), [sorted, group, now]);

  const filtersActive = text.trim() !== "" || status !== "all" || createdFrom !== "" || createdTo !== "";

  const toggleSort = (key: InstanceSortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const statusLabel = (value: InstanceStatus) =>
    value === "alive" ? t("statusAlive") : value === "expired" ? t("statusExpired") : t("statusUnknown");

  const groupName = (groupKey: string) =>
    group === "uid" ? groupKey : statusLabel(groupKey as InstanceStatus);

  const columns: { id: string; sortKey?: InstanceSortKey; label: string }[] = [
    { id: "id", sortKey: "instanceId", label: t("instancesColId") },
    { id: "status", label: t("instancesColStatus") },
    { id: "owner", sortKey: "uid", label: t("instancesColOwner") },
    { id: "created", sortKey: "createdAt", label: t("instancesColCreated") },
    { id: "updated", sortKey: "updatedAt", label: t("instancesColUpdated") },
    { id: "expires", sortKey: "expiresAt", label: t("instancesColExpires") },
    { id: "remaining", label: t("instancesColRemaining") },
    { id: "url", label: t("instancesColUrl") },
  ];

  return (
    <section style={panelStyle} aria-label={t("instancesTitle")}>
      {/* 工具条：文本搜索 / 状态 / 创建日期区间 / 分组 / 刷新（全部本地即时
          生效；原标题块已并入此工具条与表格底部的统计行）。 */}
      <div role="search" style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t("instancesSearchPlaceholder")}
          aria-label={t("instancesSearchPlaceholder")}
          style={{ ...controlStyle, minWidth: 220 }}
        />
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as InstanceStatus | "all")}
          aria-label={t("instancesColStatus")}
          style={{ ...controlStyle, cursor: "pointer" }}
        >
          <option value="all">{t("instancesStatusAll")}</option>
          <option value="alive">{t("statusAlive")}</option>
          <option value="expired">{t("statusExpired")}</option>
          <option value="unknown">{t("statusUnknown")}</option>
        </select>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
          <span style={mutedStyle}>{t("instancesDateFrom")}</span>
          <input
            type="date"
            value={createdFrom}
            onChange={(event) => setCreatedFrom(event.target.value)}
            aria-label={t("instancesDateFrom")}
            style={controlStyle}
          />
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
          <span style={mutedStyle}>{t("instancesDateTo")}</span>
          <input
            type="date"
            value={createdTo}
            onChange={(event) => setCreatedTo(event.target.value)}
            aria-label={t("instancesDateTo")}
            style={controlStyle}
          />
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
          <span style={mutedStyle}>{t("instancesGroupLabel")}</span>
          <select
            value={group}
            onChange={(event) => setGroup(event.target.value as InstanceGroupKey)}
            aria-label={t("instancesGroupLabel")}
            style={{ ...controlStyle, cursor: "pointer" }}
          >
            <option value="none">{t("instancesGroupNone")}</option>
            <option value="uid">{t("instancesGroupUser")}</option>
            <option value="status">{t("instancesGroupStatus")}</option>
          </select>
        </span>
        <Button onClick={onRefresh} disabled={loading}>
          {loading ? t("instancesLoading") : t("instancesRefresh")}
        </Button>
      </div>

      {error ? (
        <p style={{ ...mutedStyle, margin: 0 }}>{error}</p>
      ) : records.length === 0 ? (
        <p style={{ ...mutedStyle, margin: 0 }}>{loading ? t("instancesLoading") : t("instancesEmpty")}</p>
      ) : sorted.length === 0 ? (
        <p style={{ ...mutedStyle, margin: 0 }}>{t("instancesNoMatch")}</p>
      ) : (
        <div style={tableWrapperStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                {columns.map((col) => {
                  const active = col.sortKey !== undefined && col.sortKey === sortKey;
                  return (
                    <th
                      key={col.id}
                      style={thStyle}
                      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                    >
                      {col.sortKey ? (
                        <button
                          type="button"
                          style={thButtonStyle}
                          onClick={() => toggleSort(col.sortKey as InstanceSortKey)}
                          aria-label={t("instancesSortLabel", { col: col.label })}
                        >
                          {col.label}
                          {active ? <span aria-hidden="true">{sortDir === "asc" ? "▲" : "▼"}</span> : null}
                        </button>
                      ) : (
                        col.label
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {groups.map((grp) => (
                <GroupBlock
                  key={grp.key || "all"}
                  groupKey={grp.key}
                  groupRecords={grp.records}
                  grouped={group !== "none"}
                  now={now}
                  statusLabel={statusLabel}
                  groupName={groupName}
                />
              ))}
            </tbody>
            <tfoot>
              {/* 统计行：总数 + 筛选命中数（筛选生效时一并展示）。 */}
              <tr>
                <td
                  colSpan={8}
                  style={{
                    ...tdStyle,
                    background: "var(--color-tint)",
                    fontWeight: 800,
                    whiteSpace: "nowrap",
                    borderBottom: "none",
                  }}
                >
                  {filtersActive
                    ? `${t("instancesCount", { count: records.length })} · ${t("instancesFilteredCount", { count: sorted.length })}`
                    : t("instancesCount", { count: records.length })}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

type GroupBlockProps = {
  groupKey: string;
  groupRecords: SandboxInstanceRecord[];
  grouped: boolean;
  now: number;
  statusLabel: (value: InstanceStatus) => string;
  groupName: (key: string) => string;
};

/** 一个分组块：分组模式渲染组头行（跨全列），随后是组内数据行。 */
function GroupBlock({ groupKey, groupRecords, grouped, now, statusLabel, groupName }: GroupBlockProps) {
  const t = useTranslations("tools.sandbox");
  return (
    <>
      {grouped ? (
        <tr>
          <td
            colSpan={8}
            style={{
              ...tdStyle,
              background: "var(--color-tint-strong)",
              fontWeight: 800,
              whiteSpace: "nowrap",
            }}
          >
            {t("instancesGroupCount", { name: groupName(groupKey), count: groupRecords.length })}
          </td>
        </tr>
      ) : null}
      {groupRecords.map((record) => {
        const status = instanceStatus(record, now);
        const remaining = remainingMs(record.expiresAt, now);
        return (
          <tr key={record.instanceId}>
            <td style={tdStyle}>{record.instanceId}</td>
            <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
              <span style={statusBadgeStyle(status)}>{statusLabel(status)}</span>
            </td>
            <td style={tdStyle}>{record.uid}</td>
            <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{formatDateTime(record.createdAt)}</td>
            <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{formatDateTime(record.updatedAt)}</td>
            <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
              {record.expiresAt ? formatDateTime(Date.parse(record.expiresAt)) : "—"}
            </td>
            <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
              {remaining === null ? "—" : formatRemainingMs(remaining)}
            </td>
            <td style={tdStyle}>
              {record.externalUrl ? (
                <a href={record.externalUrl} target="_blank" rel="noreferrer" title={record.externalUrl}>
                  {shortUrl(record.externalUrl)}
                </a>
              ) : (
                "—"
              )}
            </td>
          </tr>
        );
      })}
    </>
  );
}
