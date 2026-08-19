"use client";

import { useState, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { formatTimezone } from "../utils";
import { useStickyState } from "./useStickyState";

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
    <div className="tool-body">
      <label className="tool-label" htmlFor="ts-now">
        {t("labels.currentTs")}
      </label>
      <div className="ts-now-row">
        <input
          className="tool-input"
          id="ts-now"
          type="text"
          readOnly
          value={tsNow}
        />
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={refreshTs}
        >
          {t("actions.refresh")}
        </button>
      </div>

      <label className="tool-label" htmlFor="ts-ts-input">
        {t("labels.tsToDate")}
      </label>
      <input
        className="tool-input"
        id="ts-ts-input"
        type="text"
        placeholder={t("placeholders.tsInput")}
        value={tsInput}
        onChange={(e) => handleTsToDate(e.target.value)}
      />
      {tsToDate && (
        <div
          className={`tool-result ${tsToDateErr ? "tool-result--err" : "tool-result--ok"}`}
          aria-live="polite"
        >
          {tsToDate}
        </div>
      )}

      <label className="tool-label" htmlFor="ts-date-input">
        {t("labels.dateToTs")}
      </label>
      <input
        className="tool-input"
        id="ts-date-input"
        type="text"
        placeholder={t("placeholders.dateInput")}
        value={dateInput}
        onChange={(e) => handleTsToTs(e.target.value)}
      />
      {tsToTs && (
        <div
          className={`tool-result ${tsToTsErr ? "tool-result--err" : "tool-result--ok"}`}
          aria-live="polite"
        >
          {tsToTs}
        </div>
      )}
    </div>
  );
}
