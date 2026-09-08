"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import CodeBlock from "../../blog/components/CodeBlock";
import { extractClientIp, parseUserAgent } from "./utils";

/** `/api/headers` 端点返回的载荷结构。 */
interface HeadersPayload {
  method: string;
  url: string;
  ip: string | null;
  headers: Record<string, string>;
}

/** Header names containing these keywords are surfaced as geo/network clues. */
const GEO_KEYWORDS = [
  "country",
  "region",
  "city",
  "latitude",
  "longitude",
  "timezone",
  "continent",
];

/** Payload-related headers that should not participate in the geo scan. */
const GEO_EXCLUDE = new Set(["accept-language", "cookie"]);

function collectGeoHeaders(all: Record<string, string>) {
  return Object.entries(all).filter(
    ([name]) =>
      !GEO_EXCLUDE.has(name) && GEO_KEYWORDS.some((k) => name.includes(k))
  );
}

/** 从回显 URL 中提取主机名，解析失败时回退为空串。 */
function safeHost(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

type LoadStatus = "loading" | "error" | "ready";

/**
 * HTTP 体检页的动态部分 —— 浏览器端 fetch `/api/headers`。
 *
 * 页面本体（page.tsx）不再读取请求头，得以静态渲染并进入 CDN 缓存；
 * 每次"服务器视角"的数据都在客户端拉取，仍保持逐次请求实时刷新。
 */
export default function HttpCheckClient() {
  // 本页文案挂在 `tools.httpCheck` 命名空间下（与 messages/*.json 层级一致）。
  const t = useTranslations("tools.httpCheck");

  const [status, setStatus] = useState<LoadStatus>("loading");
  const [payload, setPayload] = useState<HeadersPayload | null>(null);
  // 递增触发重新拉取（重试按钮）。
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // cancelled 标记防止竞态：组件卸载或发起新一轮拉取后，丢弃过期响应。
    let cancelled = false;
    // no-store：体检数据必须反映"当前这一次"请求，任何缓存都无意义。
    fetch("/api/headers", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as HeadersPayload;
      })
      .then((data) => {
        if (!cancelled) {
          setPayload(data);
          setStatus("ready");
        }
      })
      .catch(() => {
        // 请求失败只进入错误态，页面不崩溃。
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // 重试：回到加载态并递增 attempt 触发 effect 重新拉取。
  const retry = useCallback(() => {
    setStatus("loading");
    setAttempt((a) => a + 1);
  }, []);

  const cardStyle = {
    gridColumn: '1 / -1' as const,
    background: 'var(--color-surface)',
    border: '3px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-sm)',
    padding: 'var(--space-lg)',
  };

  // ---- 派生数据（非 ready 态时基于空对象推导，结果不渲染）----
  const all = payload?.headers ?? {};
  const sortedHeaders = Object.entries(all).sort(([a], [b]) => a.localeCompare(b));
  const clientIp = payload
    ? (extractClientIp(all) ??
      (payload.ip ? { ip: payload.ip, source: "x-forwarded-for" } : null))
    : null;
  const ua = parseUserAgent(all["user-agent"] ?? "");
  const geoEntries = collectGeoHeaders(all);
  // curl 示例的主机名：优先 Host 请求头，回退到回显 URL 的 host。
  const host = all["host"] ?? safeHost(payload?.url);

  // 非就绪状态下各卡片主体显示的占位文案。
  const placeholder =
    status === "loading" ? t("loading") : status === "error" ? t("loadError") : null;

  return (
    <>
      {/* ---- 错误态：fetch 失败时给出可重试的提示 ---- */}
      {status === "error" && (
        <section style={{ ...cardStyle, marginBottom: 'var(--space-lg)' }}>
          <p style={{ margin: '0 0 1rem' }}>{t("loadError")}</p>
          <button type="button" onClick={retry} className="btn btn--primary btn--sm">
            {t("retry")}
          </button>
        </section>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))',
          gap: 'var(--space-md)',
          marginBottom: 'var(--space-lg)',
        }}
      >
        {/* ---- 来源 IP ---- */}
        <section style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>{t("ipCard")}</h3>
          {placeholder ?? (
            clientIp ? (
              <>
                <p
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--fs-2xl)',
                    fontWeight: 800,
                    color: 'var(--color-primary)',
                    margin: '0 0 0.5rem',
                    wordBreak: 'break-all',
                  }}
                >
                  {clientIp.ip}
                </p>
                <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)' }}>
                  {t("ipSource")}：<code className="blog-inline-code">{clientIp.source}</code>
                </p>
              </>
            ) : (
              <p style={{ margin: 0 }}>{t("ipUnknown")}</p>
            )
          )}
        </section>

        {/* ---- Client & device ---- */}
        <section style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>{t("deviceCard")}</h3>
          {placeholder ?? (
            <dl style={{ margin: 0, display: 'grid', rowGap: '0.5rem' }}>
              <div>
                <dt style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)', display: 'inline' }}>
                  {t("browserLabel")}：
                </dt>
                <dd style={{ display: 'inline', margin: 0, fontWeight: 700 }}>
                  {ua.browser}
                  {ua.version ? (
                    <span style={{ fontFamily: 'var(--font-mono)' }}> ({ua.version})</span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)', display: 'inline' }}>
                  {t("osLabel")}：
                </dt>
                <dd style={{ display: 'inline', margin: 0, fontWeight: 700 }}>{ua.os}</dd>
              </div>
              <div>
                <dt style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)', display: 'inline' }}>
                  {t("deviceLabel")}：
                </dt>
                <dd style={{ display: 'inline', margin: 0, fontWeight: 700 }}>
                  {t(`devices.${ua.device}`)}
                </dd>
              </div>
            </dl>
          )}
        </section>

        {/* ---- 地理线索 ---- */}
        <section style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>{t("geoCard")}</h3>
          {placeholder ?? (
            geoEntries.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                {geoEntries.map(([name, value]) => (
                  <li key={name} style={{ marginBottom: '0.35rem' }}>
                    <code className="blog-inline-code">{name}</code>
                    <span style={{ marginLeft: '0.5rem' }}>{value}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>{t("geoEmpty")}</p>
            )
          )}
        </section>
      </div>

      {/* ---- Full request headers ---- */}
      <section style={{ ...cardStyle, marginBottom: 'var(--space-lg)' }}>
        <h3 style={{ marginTop: 0 }}>
          {t("headersCard")}
          <span style={{ fontWeight: 400, fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)', marginLeft: '0.5rem' }}>
            {placeholder ?? t("headerCount", { count: sortedHeaders.length })}
          </span>
        </h3>
        {placeholder ?? (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--fs-sm)',
                }}
              >
                <tbody>
                  {sortedHeaders.map(([name, value]) => (
                    <tr key={name}>
                      <td
                        style={{
                          padding: '0.4rem 0.75rem 0.4rem 0',
                          whiteSpace: 'nowrap',
                          fontWeight: 700,
                          color: 'var(--color-primary)',
                          verticalAlign: 'top',
                        }}
                      >
                        {name}
                      </td>
                      <td style={{ padding: '0.4rem 0', wordBreak: 'break-all' }}>{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ margin: '1rem 0 0', fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)' }}>
              {t("refreshHint")}
            </p>
          </>
        )}
      </section>

      {/* ---- JSON 回显 API ---- */}
      <section style={cardStyle}>
        <h3 style={{ marginTop: 0 }}>{t("apiCard")}</h3>
        <p>{t("apiDesc")}</p>
        <p style={{ marginBottom: '1rem' }}>
          <a href="/api/echo" target="_blank" rel="noreferrer" className="btn btn--primary btn--sm">
            {t("openApi")} ↗
          </a>
        </p>
        {placeholder ?? (
          <CodeBlock
            title={`curl · ${host}`}
            code={`curl -X POST https://${host}/api/echo \\
  -H "content-type: application/json" \\
  -d '{"hello":"world"}'`}
          />
        )}
      </section>
    </>
  );
}
