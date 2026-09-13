"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  encodeBase64,
  decodeBase64,
  encodeBase64Url,
  decodeBase64Url,
} from "../utils";
import { useStickyState } from "./useStickyState";
import { Button, Textarea } from "../../components/ui";
import { ToolActions, ToolResult, ToolShell } from "./ToolShell";
import { CopyButton } from "./CopyButton";

export default function Base64Tool() {
  const t = useTranslations("tools");
  const [b64Input, setB64Input] = useStickyState("", "b64Input");
  const [b64Output, setB64Output] = useState("");
  const [b64Err, setB64Err] = useState(false);
  const [b64UrlSafe, setB64UrlSafe] = useStickyState(false, "b64UrlSafe");

  const b64Encode = () => {
    try {
      setB64Output(b64UrlSafe ? encodeBase64Url(b64Input) : encodeBase64(b64Input));
      setB64Err(false);
    } catch {
      setB64Output(t("errors.encodeFailed"));
      setB64Err(true);
    }
  };

  const b64Decode = () => {
    try {
      setB64Output(b64UrlSafe ? decodeBase64Url(b64Input.trim()) : decodeBase64(b64Input.trim()));
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
    <ToolShell>
      <Textarea
        rows={4}
        placeholder={t("placeholders.b64")}
        aria-label={t("labels.b64Input")}
        value={b64Input}
        onChange={(e) => setB64Input(e.target.value)}
      />
      <ToolActions>
        <Button
          variant={b64UrlSafe ? "primary" : "secondary"}
          size="sm"
          aria-pressed={b64UrlSafe}
          onClick={() => setB64UrlSafe(!b64UrlSafe)}
        >
          {t("actions.urlSafe")}
        </Button>
        <Button variant="primary" size="sm" onClick={b64Encode}>
          {t("actions.encode")}
        </Button>
        <Button variant="secondary" size="sm" onClick={b64Decode}>
          {t("actions.decode")}
        </Button>
        <Button variant="secondary" size="sm" onClick={b64Clear}>
          {t("actions.clear")}
        </Button>
        {b64Output && !b64Err ? <CopyButton value={b64Output} /> : null}
      </ToolActions>
      <ToolResult tone={b64Err ? "err" : "ok"}>{b64Output}</ToolResult>
    </ToolShell>
  );
}
