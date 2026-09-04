import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { headers } from "next/headers";
import CodeBlock from "../../blog/components/CodeBlock";
import { extractClientIp, parseUserAgent } from "./utils";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "tools" });
  return {
    title: t("items.httpCheck.name"),
    description: t("items.httpCheck.description"),
  };
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

export default async function HttpCheckPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Catalog metadata and page copy are both namespaced under `tools`.
  const t = await getTranslations("tools");

  // Read every header of the incoming request on the server — the page
  // therefore has to render dynamically.
  const h = await headers();
  const all: Record<string, string> = {};
  h.forEach((value, key) => {
    all[key] = value;
  });

  const clientIp = extractClientIp(all);
  const ua = parseUserAgent(all["user-agent"] ?? "");
  const geoEntries = collectGeoHeaders(all);
  const sortedHeaders = Object.entries(all).sort(([a], [b]) => a.localeCompare(b));

  const cardStyle = {
    gridColumn: '1 / -1' as const,
    background: 'var(--color-surface)',
    border: '3px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-sm)',
    padding: 'var(--space-lg)',
  };

  return (
    <>
      <h1 className="sr-only">{t("items.httpCheck.name")}</h1>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))',
          gap: 'var(--space-md)',
          marginBottom: 'var(--space-lg)',
        }}
      >
        {/* ---- Source IP ---- */}
        <section style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>{t("ipCard")}</h3>
          {clientIp ? (
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
          )}
        </section>

        {/* ---- Client & device ---- */}
        <section style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>{t("deviceCard")}</h3>
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
        </section>

        {/* ---- Geo clues ---- */}
        <section style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>{t("geoCard")}</h3>
          {geoEntries.length > 0 ? (
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
          )}
        </section>
      </div>

      {/* ---- Full request headers ---- */}
      <section style={{ ...cardStyle, marginBottom: 'var(--space-lg)' }}>
        <h3 style={{ marginTop: 0 }}>
          {t("headersCard")}
          <span style={{ fontWeight: 400, fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)', marginLeft: '0.5rem' }}>
            {t("headerCount", { count: sortedHeaders.length })}
          </span>
        </h3>
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
      </section>

      {/* ---- JSON echo API ---- */}
      <section style={cardStyle}>
        <h3 style={{ marginTop: 0 }}>{t("apiCard")}</h3>
        <p>{t("apiDesc")}</p>
        <p style={{ marginBottom: '1rem' }}>
          <a href="/api/echo" target="_blank" rel="noreferrer" className="btn btn--primary btn--sm">
            {t("openApi")} ↗
          </a>
        </p>
        <CodeBlock
          title={`curl · ${all["host"] ?? ""}`}
          code={`curl -X POST https://${all["host"] ?? ""}/api/echo \\
  -H "content-type: application/json" \\
  -d '{"hello":"world"}'`}
        />
      </section>
    </>
  );
}
