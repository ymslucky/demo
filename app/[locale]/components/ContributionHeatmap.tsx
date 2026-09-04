"use client";

import type { CSSProperties } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ContributionsData } from "../../lib/contributions";

/** Contribution count → intensity level 0..4 (mirrors the legend). */
function level(count: number): number {
  if (count <= 0) return 0;
  if (count < 4) return 1;
  if (count < 8) return 2;
  if (count < 12) return 3;
  return 4;
}

/** Grid rows (Sunday-first) that get a weekday tick: Mon / Wed / Fri. */
const WEEKDAY_ROWS = [1, 3, 5];

/** Parses an ISO date (YYYY-MM-DD) as local midnight, avoiding UTC shifts. */
function parseDay(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

export default function ContributionHeatmap({
  data,
}: {
  /** Server-fetched calendar (ISR); `null` renders the unavailable state. */
  data: ContributionsData | null;
}) {
  const t = useTranslations("home.heatmap");
  const locale = useLocale();

  if (!data) {
    return <p className="heatmap-status">{t("unavailable")}</p>;
  }

  const total = data.weeks.flat().reduce((sum, day) => sum + day.c, 0);
  const summary = t("total", { count: total, login: data.login });

  const monthFmt = new Intl.DateTimeFormat(locale, { month: "short" });
  const weekdayFmt = new Intl.DateTimeFormat(locale, { weekday: "short" });
  const tooltipFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  /**
   * Month ticks: the first week column whose Sunday starts a new month.
   * The leading partial column is skipped, same as GitHub's own heatmap.
   */
  const monthTicks: { col: number; label: string }[] = [];
  let lastMonth = -1;
  data.weeks.forEach((week, wi) => {
    const sunday = parseDay(week[0].d);
    if (wi === 0) {
      lastMonth = sunday.getMonth();
      return;
    }
    if (sunday.getMonth() !== lastMonth) {
      lastMonth = sunday.getMonth();
      monthTicks.push({ col: wi, label: monthFmt.format(sunday) });
    }
  });

  /** Any complete week works as the source of weekday tick labels. */
  const midWeek = data.weeks[Math.floor(data.weeks.length / 2)];

  return (
    <div className="heatmap">
      <div className="heatmap-scroller">
        <div
          className="heatmap-gridwrap"
          style={{ "--heatmap-weeks": data.weeks.length } as CSSProperties}
        >
          <div className="heatmap-months" aria-hidden="true">
            {monthTicks.map(({ col, label }) => (
              <span key={col} style={{ gridColumnStart: col + 1 }}>
                {label}
              </span>
            ))}
          </div>
          <div className="heatmap-weekdays" aria-hidden="true">
            {WEEKDAY_ROWS.map((row) => (
              <span key={row} style={{ gridRowStart: row + 1 }}>
                {weekdayFmt.format(parseDay(midWeek[row].d))}
              </span>
            ))}
          </div>
          <div className="heatmap-grid" role="img" aria-label={summary}>
            {data.weeks.map((week, wi) => (
              <div className="heatmap-col" key={wi}>
                {week.map((day) => (
                  <span
                    key={day.d}
                    className="heatmap-cell"
                    data-level={level(day.c)}
                    title={t("dayTooltip", {
                      count: day.c,
                      date: tooltipFmt.format(parseDay(day.d)),
                    })}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="heatmap-footer">
        <p className="heatmap-total">{summary}</p>
        <div className="heatmap-legend" aria-hidden="true">
          <span className="heatmap-legend-label">{t("less")}</span>
          {[0, 1, 2, 3, 4].map((l) => (
            <span key={l} className="heatmap-cell" data-level={l} />
          ))}
          <span className="heatmap-legend-label">{t("more")}</span>
        </div>
      </div>
    </div>
  );
}
