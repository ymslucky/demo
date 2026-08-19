"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { encodeBase64, decodeBase64 } from "../utils";
import { useStickyState } from "./useStickyState";

export default function Base64Tool() {
  const t = useTranslations("tools");
  const [b64Input, setB64Input] = useStickyState("", "b64Input");
  const [b64Output, setB64Output] = useState("");
  const [b64Err, setB64Err] = useState(false);

  const b64Encode = () => {
    try {
      setB64Output(encodeBase64(b64Input));
      setB64Err(false);
    } catch {
      setB64Output(t("errors.encodeFailed"));
      setB64Err(true);
    }
  };

  const b64Decode = () => {
    try {
      setB64Output(decodeBase64(b64Input.trim()));
      setB64Err(false);
    } catch {
      setB64Output(t("errors.invalidBase64"));
      setB64Err(true);
    }
  };

  const b64Clear = () => {
    setB64Input("");
    setB64Output("");
  };

  return (
    <div className="tool-body">
      <textarea
        className="tool-textarea"
        rows={4}
        placeholder={t("placeholders.b64")}
        aria-label={t("labels.b64Input")}
        value={b64Input}
        onChange={(e) => setB64Input(e.target.value)}
      />
      <div className="tool-actions">
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={b64Encode}
        >
          {t("actions.encode")}
        </button>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={b64Decode}
        >
          {t("actions.decode")}
        </button>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={b64Clear}
        >
          {t("actions.clear")}
        </button>
      </div>
      {b64Output && (
        <div
          className={`tool-result ${b64Err ? "tool-result--err" : "tool-result--ok"}`}
          aria-live="polite"
        >
          {b64Output}
        </div>
      )}
    </div>
  );
}
