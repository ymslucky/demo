"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { WallItem, WallLabels } from "./components/CardWall3D";

const CardWall3D = dynamic(() => import("./components/CardWall3D"), {
  ssr: false,
});

interface ProjectsClientProps {
  heading: string;
  subtitle: string;
  items: WallItem[];
  labels: WallLabels;
}

/** Static grid fallback: SSR output / mobile / reduced-motion preference */
function StaticGrid({ heading, subtitle, items, labels }: ProjectsClientProps) {
  return (
    <>
      <h1 className="page-title">{heading}</h1>
      <p className="page-subtitle">{subtitle}</p>

      <div className="card-grid">
        {items.map((item) => (
          <article key={item.key} className="card project-card">
            <h3>
              <a href={item.repo} target="_blank" rel="noopener noreferrer">
                {item.name}
              </a>
            </h3>
            <p>{item.description}</p>
            <div className="tag-list">
              {item.tags.map((tag) => (
                <span key={tag} className="tag">
                  {tag}
                </span>
              ))}
            </div>
            <div className="project-links">
              {item.demo && (
                <a href={item.demo} target="_blank" rel="noopener noreferrer">
                  {labels.demo}
                </a>
              )}
              <a href={item.repo} target="_blank" rel="noopener noreferrer">
                {labels.source}
              </a>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

export default function ProjectsClient(props: ProjectsClientProps) {
  const [immersive, setImmersive] = useState(false);

  useEffect(() => {
    const wide = window.matchMedia("(min-width: 900px)");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setImmersive(wide.matches && !reduce.matches);
    update();
    wide.addEventListener("change", update);
    reduce.addEventListener("change", update);
    return () => {
      wide.removeEventListener("change", update);
      reduce.removeEventListener("change", update);
    };
  }, []);

  if (!immersive) return <StaticGrid {...props} />;

  return (
    <CardWall3D
      items={props.items}
      labels={props.labels}
      heading={props.heading}
      subtitle={props.subtitle}
    />
  );
}
