"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Show, SignInButton } from "@clerk/nextjs";
import { normalizeItems, type TodoItem } from "./utils";

// 与 http-check 工具页保持一致的 Neo-Brutalism 卡片样式（内联变量）。
const cardStyle = {
  gridColumn: "1 / -1" as const,
  background: "var(--color-surface)",
  border: "3px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--shadow-sm)",
  padding: "var(--space-lg)",
};

const mutedStyle = {
  fontSize: "var(--fs-sm)",
  color: "var(--color-text-muted)",
} as const;

const inputStyle = {
  flex: 1,
  minWidth: 0,
  padding: "0.5rem 0.75rem",
  border: "3px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
  font: "inherit",
} as const;

const rowStyle = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-sm)",
  padding: "var(--space-xs) var(--space-sm)",
  border: "3px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  background: "var(--color-surface)",
} as const;

const doneStyle = {
  textDecoration: "line-through",
  color: "var(--color-text-muted)",
} as const;

/** 调用 /api/todo：body 缺省时发无载荷请求（GET），否则发 JSON。 */
async function fetchItems(method: "GET" | "POST" | "PATCH" | "DELETE", body?: unknown) {
  const res = await fetch("/api/todo", {
    method,
    cache: "no-store",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) return { unauthorized: true as const, data: null };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { unauthorized: false as const, data: normalizeItems(await res.json()) };
}

/**
 * 登录后的清单面板：初始加载一次；增删改均先本地乐观更新，再用服务端
 * 回包覆盖（回包异常时退回 GET 纠偏）。
 */
function TodoPanel() {
  const t = useTranslations("tools.todo");

  const [items, setItems] = useState<TodoItem[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "expired">("loading");
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  // 卸载后丢弃过期响应，避免对已卸载组件 setState。
  const aliveRef = useRef(true);

  const apply = useCallback((data: TodoItem[] | null) => {
    if (data) {
      setItems(data);
      setStatus("ready");
    } else {
      setStatus("error");
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const { unauthorized, data } = await fetchItems("GET");
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
    // 路径）。
    const kickoff = setTimeout(load, 0);
    return () => {
      aliveRef.current = false;
      clearTimeout(kickoff);
    };
  }, [load]);

  const add = useCallback(async () => {
    const title = draft.trim();
    if (!title || pending) return;
    setPending(true);
    try {
      const { unauthorized, data } = await fetchItems("POST", { title });
      if (!aliveRef.current) return;
      if (unauthorized) {
        setStatus("expired");
        return;
      }
      if (data) {
        setItems(data);
        setStatus("ready");
        setDraft("");
      } else {
        setStatus("error");
      }
    } catch {
      if (aliveRef.current) setStatus("error");
    } finally {
      if (aliveRef.current) setPending(false);
    }
  }, [draft, pending]);

  const toggle = useCallback(
    async (item: TodoItem) => {
      // 乐观切换 done，服务端回包到达后覆盖。
      setItems((current) =>
        current
          ? current.map((entry) =>
              entry.id === item.id ? { ...entry, done: !entry.done } : entry,
            )
          : current,
      );
      try {
        const { unauthorized, data } = await fetchItems("PATCH", {
          id: item.id,
          done: !item.done,
        });
        if (!aliveRef.current) return;
        if (unauthorized) {
          setStatus("expired");
          return;
        }
        // 回包异常（结构损坏）时退回 GET 快照纠偏。
        if (data) setItems(data);
        else load();
      } catch {
        if (aliveRef.current) load();
      }
    },
    [load],
  );

  const remove = useCallback(
    async (id: string) => {
      // 乐观移除，服务端回包到达后覆盖。
      setItems((current) => (current ? current.filter((entry) => entry.id !== id) : current));
      try {
        const { unauthorized, data } = await fetchItems("DELETE", { id });
        if (!aliveRef.current) return;
        if (unauthorized) {
          setStatus("expired");
          return;
        }
        if (data) setItems(data);
      } catch {
        if (aliveRef.current) load();
      }
    },
    [load],
  );

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

  if (status === "error" || items === null) {
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
      <form
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
        style={{ display: "flex", gap: "var(--space-sm)", marginBottom: "var(--space-md)" }}
      >
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t("inputPlaceholder")}
          aria-label={t("inputPlaceholder")}
          maxLength={200}
          style={inputStyle}
        />
        <button
          type="submit"
          disabled={pending || draft.trim().length === 0}
          className="btn btn--primary btn--sm"
        >
          {t("add")}
        </button>
      </form>
      {items.length === 0 ? <p style={mutedStyle}>{t("empty")}</p> : null}
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "grid",
          gap: "var(--space-sm)",
        }}
      >
        {items.map((item) => (
          <li key={item.id} style={rowStyle}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-sm)",
                flex: 1,
                minWidth: 0,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={item.done}
                onChange={() => toggle(item)}
                style={{ accentColor: "var(--color-primary)", flex: "none" }}
              />
              <span style={item.done ? doneStyle : undefined}>{item.title}</span>
            </label>
            <button
              type="button"
              onClick={() => remove(item.id)}
              aria-label={t("deleteItem", { title: item.title })}
              style={{
                flex: "none",
                border: "3px solid var(--color-border)",
                borderRadius: "var(--radius-sm)",
                background: "var(--color-surface)",
                color: "var(--color-text)",
                fontWeight: 700,
                lineHeight: 1,
                padding: "0.25rem 0.6rem",
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      {items.length > 0 ? (
        <p style={{ ...mutedStyle, margin: "var(--space-md) 0 0" }}>
          {t("itemCount", { count: items.length })}
        </p>
      ) : null}
      <p style={{ ...mutedStyle, margin: "var(--space-sm) 0 0" }}>{t("kvHint")}</p>
    </section>
  );
}

/**
 * TODO List client. Clerk's <Show> gates the tool to signed-in users:
 * signed-out visitors see the sign-in prompt, signed-in users get the
 * panel. A 401 from the API flips the panel into the expired state on
 * its own.
 */
export default function TodoClient() {
  const t = useTranslations("tools.todo");

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
        <TodoPanel />
      </Show>
    </>
  );
}
