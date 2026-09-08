"use client";

/**
 * About 页的 GitHub stars 展示卡（客户端组件）。
 *
 * 挂载后请求本站代理端点 /api/github/stars（数据在服务端经 fetch
 * revalidate 缓存一小时），展示总星数与星数最高的三个仓库外链。
 * 加载/失败态仅做简洁提示，绝不抛出未捕获异常。
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Alert, Card } from "./ui";

interface StarsPayload {
  totalStars: number;
  publicRepoCount: number;
  top: Array<{ name: string; stars: number; htmlUrl: string }>;
}

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ok"; data: StarsPayload };

export default function GithubStarsCard() {
  const t = useTranslations("about");
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    // cancelled 标记防止组件卸载后仍然 setState。
    let cancelled = false;
    fetch("/api/github/stars")
      .then(async (res) => {
        if (!res.ok) throw new Error(`upstream ${res.status}`);
        return (await res.json()) as StarsPayload;
      })
      .then((data) => {
        if (!cancelled && data && Array.isArray(data.top)) {
          setState({ status: "ok", data });
        } else if (!cancelled) {
          setState({ status: "error" });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card as="section" className="github-stars">
      <h2>{t("githubStarsTitle")}</h2>

      {state.status === "loading" && (
        <p className="github-stars-meta">{t("githubStarsLoading")}</p>
      )}

      {state.status === "error" && (
        <Alert variant="err" role="alert">
          {t("githubStarsError")}
        </Alert>
      )}

      {state.status === "ok" && (
        <>
          <p className="github-stars-meta">
            {t("githubStarsTotal", { count: state.data.totalStars })} ·{" "}
            {t("githubStarsRepos", { count: state.data.publicRepoCount })}
          </p>
          <ul className="github-stars-list">
            {state.data.top.map((repo) => (
              <li key={repo.htmlUrl}>
                <a
                  href={repo.htmlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span>{repo.name}</span>
                  <span className="github-stars-count">
                    {t("githubStarsStars", { count: repo.stars })}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
