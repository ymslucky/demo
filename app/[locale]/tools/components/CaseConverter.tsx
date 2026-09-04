"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { convertCase } from "../utils";
import { useStickyState } from "./useStickyState";
import { Button, Textarea } from "../../components/ui";
import { ToolActions, ToolResult, ToolShell } from "./ToolShell";

export default function CaseConverter() {
  const t = useTranslations("tools");
  const [caseInput, setCaseInput] = useStickyState("", "caseInput");
  const [caseOutput, setCaseOutput] = useState("");

  const handleConvertCase = (mode: string) => {
    setCaseOutput(convertCase(mode, caseInput));
  };

  return (
    <ToolShell>
      <Textarea
        rows={3}
        placeholder={t("placeholders.caseInput")}
        aria-label={t("labels.textInput")}
        value={caseInput}
        onChange={(e) => setCaseInput(e.target.value)}
      />
      <ToolActions>
        <Button
          variant="primary"
          size="sm"
          onClick={() => handleConvertCase("upper")}
        >
          {t("caseModes.upper")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => handleConvertCase("lower")}
        >
          {t("caseModes.lower")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => handleConvertCase("title")}
        >
          {t("caseModes.title")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => handleConvertCase("camel")}
        >
          {t("caseModes.camel")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => handleConvertCase("snake")}
        >
          {t("caseModes.snake")}
        </Button>
      </ToolActions>
      <ToolResult>{caseOutput}</ToolResult>
    </ToolShell>
  );
}
