/**
 * GitHub contribution calendar for the homepage heatmap.
 *
 * Lives on the server: the homepage RSC awaits `getContributions()` and the
 * page is regenerated at most hourly (ISR), so the browser never issues a
 * runtime request for this data. The upstream GraphQL call is cached for one
 * hour through the Next data cache; any failure degrades to `null` and the
 * caller renders an "unavailable" placeholder.
 */

const LOGIN = process.env.GITHUB_LOGIN ?? "ymslucky";

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
  /** contribution count */
  c: number;
  /** ISO date (YYYY-MM-DD) */
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
