"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Show, SignInButton } from "@clerk/nextjs";
import { normalizeSnapshot, type CounterSnapshot } from "./utils";

// 与 http-check 工具页保持一致的 Neo-Brutalism 卡片样式（内联变量）。
const cardStyle = {
  gridColumn: "1 / -1" as const,
  background: "var(--color-surface)",
  border: "3px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--shadow-sm)",
  padding: "var(--space-lg)",
};

const POLL_INTERVAL_MS = 5_000;

const numberStyle = {
  fontFamily: "var(--font-mono)",
  fontSize: "var(--fs-3xl)",
  fontWeight: 800,
  color: "var(--color-primary)",
  margin: "0",
  lineHeight: 1.1,
} as const;

const mutedStyle = {
  fontSize: "var(--fs-sm)",
  color: "var(--color-text-muted)",
} as const;

/** 读取 /api/counter 的响应结构（登录态下 GET）。 */
async function fetchSnapshot(method: "GET" | "POST") {
  const res = await fetch("/api/counter", { method, cache: "no-store" });
  if (res.status === 401) return { unauthorized: true as const, data: null };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { unauthorized: false as const, data: normalizeSnapshot(await res.json()) };
}

/**
 * 登录后的计数面板：初始加载 + 每 5s 轮询全局快照；
 * 点击 +1 时先本地乐观更新，再用服务端回包覆盖（含他人并发写入）。
 */
function CounterPanel() {
  const t = useTranslations("tools.counter");

  const [snapshot, setSnapshot] = useState<CounterSnapshot | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "expired">("loading");
  const [pending, setPending] = useState(false);
  // 卸载后丢弃过期响应，避免对已卸载组件 setState。
  const aliveRef = useRef(true);

  const apply = useCallback((data: CounterSnapshot | null) => {
    if (data) {
      setSnapshot(data);
      setStatus("ready");
    } else {
      setStatus("error");
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const { unauthorized, data } = await fetchSnapshot("GET");
      if (!aliveRef.current) return;
      if (unauthorized) {
        setStatus("expired");
        return;
      }
      apply(data);
    } catch {
      if (aliveRef.current) setStatus("error");
    }
  }, [apply]);

  useEffect(() => {
    aliveRef.current = true;
    // 首次拉取异步启动（react-hooks 禁止在 effect 体内同步进入 setState
    // 路径）；轮询 interval 的回调本身是异步触发，不受影响。
    const kickoff = setTimeout(load, 0);
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      aliveRef.current = false;
      clearTimeout(kickoff);
      clearInterval(id);
    };
  }, [load]);

  const tap = useCallback(async () => {
    if (pending) return;
    setPending(true);
    // 乐观更新：先本地 +1，服务端回包到达后以服务端为准。
    setSnapshot((s) => (s ? { ...s, total: s.total + 1, mine: s.mine + 1 } : s));
    try {
      const { unauthorized, data } = await fetchSnapshot("POST");
      if (!aliveRef.current) return;
      if (unauthorized) {
        setStatus("expired");
        return;
      }
      // 回包异常（结构损坏）时退回 GET 快照纠偏。
      if (data) apply(data);
      else load();
    } catch {
      if (aliveRef.current) load();
    } finally {
      if (aliveRef.current) setPending(false);
    }
  }, [pending, apply, load]);

  if (status === "expired") {
    return (
      <section style={cardStyle}>
        <p>{t("sessionExpired")}</p>
        <SignInButton mode="modal">
          <button type="button" className="btn btn--primary btn--sm">
            {t("gateSignIn")}
          </button>
        </SignInButton>
      </section>
    );
  }

  if (status === "loading") {
    return (
      <section style={cardStyle}>
        <p style={mutedStyle}>{t("loading")}</p>
      </section>
    );
  }

  if (status === "error" || !snapshot) {
    return (
      <section style={cardStyle}>
        <p>{t("loadError")}</p>
        <button type="button" onClick={load} className="btn btn--primary btn--sm">
          {t("retry")}
        </button>
      </section>
    );
  }

  return (
    <section style={cardStyle}>
      <h3 style={{ marginTop: 0, marginBottom: "0.5rem" }}>{t("totalLabel")}</h3>
      {/* key 随数值变化重挂载，触发 counter-pop 动画（值不变则不重播）。 */}
      <p className="counter-pop" key={snapshot.total} style={numberStyle}>
        {snapshot.total}
      </p>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--space-md)",
          margin: "var(--space-md) 0",
        }}
      >
        <span style={mutedStyle}>
          {t("mineLabel")}：{" "}
          <strong style={{ color: "var(--color-text)" }}>{snapshot.mine}</strong>
        </span>
        <span style={mutedStyle}>{t("usersLabel", { count: snapshot.users })}</span>
      </div>
      <button
        type="button"
        onClick={tap}
        disabled={pending}
        className="btn btn--primary"
        style={{ fontSize: "var(--fs-lg)", minWidth: "7rem" }}
      >
        {t("plusOne")}
      </button>
      <p style={{ ...mutedStyle, margin: "var(--space-md) 0 0" }}>{t("approxHint")}</p>
    </section>
  );
}

/**
 * Real-time counter client. Clerk's <Show> gates the tool to signed-in
 * users: signed-out visitors see the sign-in prompt, signed-in users get
 * the live panel. A 401 from the API flips the panel into the expired
 * state on its own.
 */
export default function CounterClient() {
  const t = useTranslations("tools.counter");

  return (
    <>
      <Show when="signed-out">
        <section style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>{t("gateTitle")}</h3>
          <p>{t("gateDesc")}</p>
          <SignInButton mode="modal">
            <button type="button" className="btn btn--primary btn--sm">
              {t("gateSignIn")}
            </button>
          </SignInButton>
        </section>
      </Show>
      <Show when="signed-in">
        <CounterPanel />
      </Show>
    </>
  );
}
