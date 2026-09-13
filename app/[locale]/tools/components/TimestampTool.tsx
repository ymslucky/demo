"use client";

import { useState, useCallback, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { formatTimezone } from "../utils";
import { useStickyState } from "./useStickyState";
import { Button, Input } from "../../components/ui";
import { ToolActions, ToolResult, ToolShell } from "./ToolShell";
import { CopyButton } from "./CopyButton";

export default function TimestampTool() {
  const t = useTranslations("tools");
  const locale = useLocale();

  const [tsNow, setTsNow] = useState(() => String(Math.floor(Date.now() / 1000)));
  const [tsInput, setTsInput] = useStickyState("", "tsInput");
  const [tsToDate, setTsToDate] = useState("");
  const [tsToDateErr, setTsToDateErr] = useState(false);
  const [dateInput, setDateInput] = useStickyState("", "dateInput");
  const [tsToTs, setTsToTs] = useState("");
  const [tsToTsErr, setTsToTsErr] = useState(false);

  const refreshTs = useCallback(() => {
    setTsNow(String(Math.floor(Date.now() / 1000)));
  }, []);

  // 每秒自刷新"当前时间戳"（effect 内更新，无 hydration 风险）。
  useEffect(() => {
    const id = window.setInterval(() => {
      setTsNow(String(Math.floor(Date.now() / 1000)));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const handleTsToDate = (raw: string) => {
    setTsInput(raw);
    if (!raw.trim()) {
      setTsToDate("");
      return;
    }
    let ts = Number(raw);
    if (raw.length > 10) ts = ts / 1000;
    const d = new Date(ts * 1000);
    if (isNaN(d.getTime())) {
      setTsToDate(t("errors.invalidTimestamp"));
      setTsToDateErr(true);
      return;
    }
    setTsToDate(
      d.toLocaleString(locale, { hour12: false }) + "  (" + formatTimezone(d) + ")"
    );
    setTsToDateErr(false);
  };

  const handleTsToTs = (raw: string) => {
    setDateInput(raw);
    if (!raw.trim()) {
      setTsToTs("");
      return;
    }
    const d = new Date(raw.replace(/-/g, "/"));
    if (isNaN(d.getTime())) {
      setTsToTs(t("errors.invalidDate"));
      setTsToTsErr(true);
      return;
    }
    setTsToTs(
      t("timestamp.secondsMs", {
        seconds: String(Math.floor(d.getTime() / 1000)),
        milliseconds: String(d.getTime()),
      })
    );
    setTsToTsErr(false);
  };

  return (
    <ToolShell>
      <label className="tool-label" htmlFor="ts-now">
        {t("labels.currentTs")}
      </label>
      <div className="ts-now-row">
        <Input id="ts-now" type="text" readOnly value={tsNow} />
        <CopyButton value={tsNow} />
        <Button variant="secondary" size="sm" onClick={refreshTs}>
          {t("actions.refresh")}
        </Button>
      </div>
      <p className="tool-detail">
        {t("timestamp.nowMeta", {
          ms: String(new Date(Number(tsNow) * 1000).getTime()),
          timezone: formatTimezone(new Date(Number(tsNow) * 1000)),
        })}
      </p>

      <label className="tool-label" htmlFor="ts-ts-input">
        {t("labels.tsToDate")}
      </label>
      <Input
        id="ts-ts-input"
        type="text"
        placeholder={t("placeholders.tsInput")}
        value={tsInput}
        onChange={(e) => handleTsToDate(e.target.value)}
      />
      <ToolResult tone={tsToDateErr ? "err" : "ok"}>{tsToDate}</ToolResult>
      {tsToDate && !tsToDateErr ? (
        <ToolActions>
          <CopyButton value={tsToDate} />
        </ToolActions>
      ) : null}

      <label className="tool-label" htmlFor="ts-date-input">
        {t("labels.dateToTs")}
      </label>
      <Input
        id="ts-date-input"
        type="text"
        placeholder={t("placeholders.dateInput")}
        value={dateInput}
        onChange={(e) => handleTsToTs(e.target.value)}
      />
      <ToolResult tone={tsToTsErr ? "err" : "ok"}>{tsToTs}</ToolResult>
      {tsToTs && !tsToTsErr ? (
        <ToolActions>
          <CopyButton value={tsToTs} />
        </ToolActions>
      ) : null}
    </ToolShell>
  );
}
