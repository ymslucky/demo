"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useStickyState } from "./useStickyState";

export default function JsonFormatter() {
  const t = useTranslations("tools");
  const [jsonInput, setJsonInput] = useStickyState("", "jsonInput");
  const [jsonOutput, setJsonOutput] = useState("");
  const [jsonErr, setJsonErr] = useState(false);

  const processJson = (transform: (parsed: unknown) => string) => {
    if (!jsonInput.trim()) {
      setJsonOutput("");
      return;
    }
    try {
      setJsonOutput(transform(JSON.parse(jsonInput)));
      setJsonErr(false);
    } catch {
      setJsonOutput(t("errors.invalidJson"));
      setJsonErr(true);
    }
  };

  const jsonFormat = () => processJson((p) => JSON.stringify(p, null, 2));
  const jsonMinify = () => processJson((p) => JSON.stringify(p));
  const jsonClear = () => {
    setJsonInput("");
    setJsonOutput("");
  };

  return (
    <div className="tool-body">
      <textarea
        className="tool-textarea"
        rows={6}
        placeholder={t("placeholders.jsonSample")}
        aria-label={t("labels.jsonInput")}
        value={jsonInput}
        onChange={(e) => setJsonInput(e.target.value)}
      />
      <div className="tool-actions">
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={jsonFormat}
        >
          {t("actions.format")}
        </button>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={jsonMinify}
        >
          {t("actions.minify")}
        </button>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={jsonClear}
        >
          {t("actions.clear")}
        </button>
      </div>
      {jsonOutput && (
        <div
          className={`tool-result ${jsonErr ? "tool-result--err" : "tool-result--ok"}`}
          aria-live="polite"
        >
          {jsonOutput}
        </div>
      )}
    </div>
  );
}
