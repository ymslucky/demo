"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { getPathname } from "@/i18n/navigation";
import type { WallItem, WallLabels, WallOutro } from "./components/CardWall3D";

const CardWall3D = dynamic(() => import("./components/CardWall3D"), {
  ssr: false,
});

interface ProjectsClientProps {
  heading: string;
  subtitle: string;
  items: WallItem[];
  labels: WallLabels;
  outro: WallOutro;
}

/** Grid fallback (SSR / mobile / reduced motion), optionally enhanced with CSS 3D scroll */
function StaticGrid({
  heading,
  subtitle,
  items,
  labels,
  with3d,
}: ProjectsClientProps & { with3d: boolean }) {
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!with3d || !gridRef.current) return;
    const grid = gridRef.current;
    const cards = Array.from(grid.querySelectorAll<HTMLElement>(".card"));
    if (cards.length === 0) return;

    let raf = 0;
    const update = () => {
      raf = 0;
      const vh = window.innerHeight;
      for (const card of cards) {
        const r = card.getBoundingClientRect();
        // -1 (card below viewport) .. 1 (card above viewport)
        const t = Math.max(-1, Math.min(1, (r.top + r.height / 2 - vh / 2) / (vh / 2)));
        card.style.transform = `perspective(900px) rotateX(${(t * 7).toFixed(2)}deg) translateZ(${(-Math.abs(t) * 46).toFixed(1)}px)`;
        card.style.opacity = (1 - Math.abs(t) * 0.35).toFixed(3);
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
      for (const card of cards) {
        card.style.transform = "";
        card.style.opacity = "";
      }
    };
  }, [with3d]);

  return (
    <>
      <h1 className="page-title">{heading}</h1>
      <p className="page-subtitle">{subtitle}</p>

      <div className={`card-grid${with3d ? " card-grid--3d" : ""}`} ref={gridRef}>
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
  const [mode, setMode] = useState<"immersive" | "grid">("grid");

  useEffect(() => {
    const wide = window.matchMedia("(min-width: 900px)");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setMode(wide.matches && !reduce.matches ? "immersive" : "grid");
    update();
    wide.addEventListener("change", update);
    reduce.addEventListener("change", update);
    return () => {
      wide.removeEventListener("change", update);
      reduce.removeEventListener("change", update);
    };
  }, []);

  if (mode === "immersive") {
    return (
      <CardWall3D
        items={props.items}
        labels={props.labels}
        heading={props.heading}
        subtitle={props.subtitle}
        outro={props.outro}
      />
    );
  }

  return <StaticGrid {...props} with3d />;
}
