/**
 * 首页热力图使用的 GitHub 贡献日历。
 *
 * 运行在服务端：首页 RSC 会 await `getContributions()`，并且页面最多
 * 每小时重新生成一次（ISR），因此浏览器从不会在运行时为此数据发起
 * 请求。上游 GraphQL 调用通过 Next 数据缓存缓存一小时；任何失败都会
 * 降级为 `null`，由调用方渲染"不可用"占位内容。
 */

// 贡献日历归属的 GitHub 账号（站点作者本人，无需配置）。
const LOGIN = "ymslucky";

const QUERY = `query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        weeks {
          contributionDays {
            date
            contributionCount
          }
        }
      }
    }
  }
}`;

export interface DayCell {
  /** 贡献次数 */
  c: number;
  /** ISO 日期 (YYYY-MM-DD) */
  d: string;
}

export interface ContributionsData {
  ok: true;
  login: string;
  weeks: DayCell[][];
}

export async function getContributions(): Promise<ContributionsData | null> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;

  try {
    const upstream = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `bearer ${token}`,
      },
      body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
      next: { revalidate: 3600 },
    });
    if (!upstream.ok) return null;

    const payload = await upstream.json();
    const weeks =
      payload?.data?.user?.contributionsCollection?.contributionCalendar?.weeks;
    if (!Array.isArray(weeks)) return null;

    return {
      ok: true,
      login: LOGIN,
      weeks: weeks.map(
        (week: {
          contributionDays: Array<{ date: string; contributionCount: number }>;
        }) =>
          week.contributionDays.map((day) => ({
            c: day.contributionCount,
            d: day.date,
          }))
      ),
    };
  } catch {
    return null;
  }
}
