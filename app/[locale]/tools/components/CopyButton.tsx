"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "../../components/ui";

/**
 * 一键复制按钮：写系统剪贴板后短暂切换为「已复制」反馈。
 * clipboard API 缺失或被拒（非安全上下文）时回退隐藏 textarea + execCommand。
 */
export function CopyButton({ value, label }: { value: string; label?: string }) {
  const t = useTranslations("tools");
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(0);

  // 卸载时清掉反馈计时器，避免对已卸载组件 setState。
  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const copy = useCallback(async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(value);
      ok = true;
    } catch {
      // 回退：非安全上下文（http://）下 clipboard API 缺失或被拒绝。
      try {
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        ta.remove();
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopied(true);
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1600);
    }
  }, [value]);

  return (
    <Button variant="secondary" size="sm" onClick={copy}>
      {copied ? t("actions.copied") : label ?? t("actions.copy")}
    </Button>
  );
}
