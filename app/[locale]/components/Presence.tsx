"use client";

/**
 * 实时在线人数指示器（客户端组件）。
 *
 * 匿名 sessionId 存 sessionStorage（标签页内稳定，新标签页即新访客），
 * 每 15s 向 /api/presence 发送心跳；计数加载完成前不渲染任何内容，
 * 避免页脚布局抖动。
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

const SESSION_KEY = "presence:session-id";
const HEARTBEAT_MS = 15_000;

function getSessionId(): string {
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    window.sessionStorage.setItem(SESSION_KEY, fresh);
    return fresh;
  } catch {
    // 存储不可用时退化为纯随机 id（每次挂载视为新会话）。
    return crypto.randomUUID();
  }
}

export default function Presence() {
  const t = useTranslations("footer");
  const [online, setOnline] = useState<number | null>(null);

  useEffect(() => {
    // cancelled 标记防止组件卸载后仍然 setState。
    let cancelled = false;
    const sessionId = getSessionId();

    // 心跳必须立即先行一次，否则在线数要等 15s 才包含本页访客。
    const beat = () =>
      fetch("/api/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`upstream ${res.status}`);
          return (await res.json()) as { online: number };
        })
        .then((data) => {
          if (!cancelled && typeof data.online === "number") {
            setOnline(data.online);
          }
        });

    beat().catch(() => {
      // 网络失败静默：在线人数是锦上添花的展示，不值得打扰用户。
    });
    const timer = setInterval(() => beat().catch(() => {}), HEARTBEAT_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (online === null) return null;

  return (
    <span className="presence">
      <span className="presence-dot" aria-hidden="true" />
      {t("online", { count: online })}
    </span>
  );
}
