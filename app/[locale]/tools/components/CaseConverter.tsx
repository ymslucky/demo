"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { convertCase } from "../utils";
import { useStickyState } from "./useStickyState";

export default function CaseConverter() {
  const t = useTranslations("tools");
  const [caseInput, setCaseInput] = useStickyState("", "caseInput");
  const [caseOutput, setCaseOutput] = useState("");

  const handleConvertCase = (mode: string) => {
    setCaseOutput(convertCase(mode, caseInput));
  };

  return (
    <div className="tool-body">
      <textarea
        className="tool-textarea"
        rows={3}
        placeholder={t("placeholders.caseInput")}
        aria-label={t("labels.textInput")}
        value={caseInput}
        onChange={(e) => setCaseInput(e.target.value)}
      />
      <div className="tool-actions">
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={() => handleConvertCase("upper")}
        >
          {t("caseModes.upper")}
        </button>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={() => handleConvertCase("lower")}
        >
          {t("caseModes.lower")}
        </button>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={() => handleConvertCase("title")}
        >
          {t("caseModes.title")}
        </button>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={() => handleConvertCase("camel")}
        >
          {t("caseModes.camel")}
        </button>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={() => handleConvertCase("snake")}
        >
          {t("caseModes.snake")}
        </button>
      </div>
      {caseOutput && (
        <div className="tool-result tool-result--ok" aria-live="polite">
          {caseOutput}
        </div>
      )}
    </div>
  );
}
