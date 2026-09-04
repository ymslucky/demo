/**
 * GitHub contribution heatmap data source.
 *
 * Forwards a contributionsCollection query to the GitHub GraphQL API using
 * the GITHUB_TOKEN secret and serves a compact week-by-day grid for the
 * homepage heatmap. The upstream call is cached for one hour through the
 * Next data cache; failures degrade to a small JSON error payload the
 * client renders as an "unavailable" placeholder.
 */

/** Reads the token at request time, so it must not be statically optimized. */
export const dynamic = "force-dynamic";

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

interface DayCell {
  /** contribution count */
  c: number;
  /** ISO date (YYYY-MM-DD) */
  d: string;
}

const noStore = { "cache-control": "no-store" };

function failure(reason: string, status: number) {
  return Response.json({ ok: false, reason }, { status, headers: noStore });
}

export async function GET() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return failure("missing-token", 503);
  }

  let upstream: Response;
  try {
    upstream = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `bearer ${token}`,
      },
      body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
      next: { revalidate: 3600 },
    });
  } catch {
    return failure("network-error", 502);
  }

  if (!upstream.ok) {
    return failure("github-error", 502);
  }

  const payload = await upstream.json();
  const weeks = payload?.data?.user?.contributionsCollection?.contributionCalendar?.weeks;
  if (!Array.isArray(weeks)) {
    return failure("unexpected-shape", 502);
  }

  const grid: DayCell[][] = weeks.map(
    (week: { contributionDays: Array<{ date: string; contributionCount: number }> }) =>
      week.contributionDays.map((day) => ({
        c: day.contributionCount,
        d: day.date,
      }))
  );

  return Response.json(
    { ok: true, login: LOGIN, weeks: grid },
    { headers: { "cache-control": "public, max-age=3600" } }
  );
}
