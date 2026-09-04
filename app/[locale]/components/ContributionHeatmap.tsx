"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

interface DayCell {
  /** contribution count */
  c: number;
  /** ISO date (YYYY-MM-DD) */
  d: string;
}

interface ContributionsData {
  ok: true;
  login: string;
  weeks: DayCell[][];
}

/** Contribution count → intensity level 0..4 (mirrors the legend). */
function level(count: number): number {
  if (count <= 0) return 0;
  if (count < 4) return 1;
  if (count < 8) return 2;
  if (count < 12) return 3;
  return 4;
}

export default function ContributionHeatmap() {
  const t = useTranslations("home.heatmap");
  const [data, setData] = useState<ContributionsData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/contributions")
      .then((res) =>
        res.ok ? res.json() : Promise.reject(new Error(String(res.status)))
      )
      .then((json: ContributionsData) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return <p className="heatmap-status">{t("unavailable")}</p>;
  }
  if (!data) {
    return <p className="heatmap-status">{t("loading")}</p>;
  }

  const total = data.weeks.flat().reduce((sum, day) => sum + day.c, 0);
  const summary = t("total", { count: total, login: data.login });

  return (
    <div className="heatmap">
      <p className="heatmap-total">{summary}</p>
      <div className="heatmap-scroller">
        <div
          className="heatmap-grid"
          role="img"
          aria-label={summary}
        >
          {data.weeks.map((week, wi) => (
            <div className="heatmap-col" key={wi}>
              {week.map((day) => (
                <span
                  key={day.d}
                  className="heatmap-cell"
                  data-level={level(day.c)}
                  title={t("dayTooltip", { count: day.c, date: day.d })}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="heatmap-legend" aria-hidden="true">
        <span className="heatmap-legend-label">{t("less")}</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className="heatmap-cell" data-level={l} />
        ))}
        <span className="heatmap-legend-label">{t("more")}</span>
      </div>
    </div>
  );
}
