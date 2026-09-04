"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useStickyState } from "./useStickyState";
import { Button, Textarea } from "../../components/ui";
import { ToolActions, ToolResult, ToolShell } from "./ToolShell";

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
    <ToolShell>
      <Textarea
        rows={6}
        placeholder={t("placeholders.jsonSample")}
        aria-label={t("labels.jsonInput")}
        value={jsonInput}
        onChange={(e) => setJsonInput(e.target.value)}
      />
      <ToolActions>
        <Button variant="primary" size="sm" onClick={jsonFormat}>
          {t("actions.format")}
        </Button>
        <Button variant="secondary" size="sm" onClick={jsonMinify}>
          {t("actions.minify")}
        </Button>
        <Button variant="secondary" size="sm" onClick={jsonClear}>
          {t("actions.clear")}
        </Button>
      </ToolActions>
      <ToolResult tone={jsonErr ? "err" : "ok"}>{jsonOutput}</ToolResult>
    </ToolShell>
  );
}
