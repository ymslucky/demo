"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import * as THREE from "three";
import { Link } from "@/i18n/navigation";

export interface WallItem {
  key: string;
  name: string;
  description: string;
  tags: string[];
  demo: string | null;
  repo: string;
}

export interface WallLabels {
  demo: string;
  source: string;
}

export interface WallOutro {
  title: string;
  subtitle: string;
  githubCta: string;
  contactCta: string;
  githubUrl: string;
  contactHref: string;
}

/* ---- Scene params: camera angle / distance / depth-of-field knobs ---- */
const SPACING = 6.4; // distance between cards along the Z axis
const START_Z = 5.5; // camera start distance
const END_PAD = 8; // extra flight room beyond the last card
const FOV = 55; // field of view (perspective strength)
const CARD_SCALE = 0.0095; // DOM pixels -> world units (760px card -> ~7.2 units, ~75% viewport width at focus)
const FOCUS_NEAR = 3.4; // near focal plane of the fake depth of field
const FOCUS_FAR = 8.5; // far focal plane of the fake depth of field
const OUTRO_FROM = 0.82; // scroll progress where the outro starts fading in

/* Cards fly toward the camera nearly head-on (readable at large size),
   with a small alternating lateral/vertical stagger for spatial depth. */
function cardLayout(i: number) {
  const side = i % 2 === 0 ? -1 : 1;
  const y = [0.12, -0.22, 0.35][i % 3];
  return {
    position: [side * 0.5, y, -i * SPACING] as [number, number, number],
    // subtle tilt so the wall keeps a hint of 3D without skewing the text
    rotation: [0, -side * 0.045, side * 0.012] as [number, number, number],
  };
}

/** Deterministic PRNG so the dust field stays stable across re-renders */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Camera rig: GSAP scroll progress -> damped camera flight + mouse parallax + fake DOF on DOM cards */
function Rig({
  count,
  targetProgress,
  pointer,
  stageRef,
}: {
  count: number;
  targetProgress: React.RefObject<number>;
  pointer: React.RefObject<{ x: number; y: number }>;
  stageRef: React.RefObject<HTMLDivElement | null>;
}) {
  const progress = useRef(0);
  const lookTarget = useMemo(() => new THREE.Vector3(), []);
  // card DOM elements are queried lazily once, then cached (avoids per-frame querySelectorAll)
  const cachedCards = useRef<NodeListOf<HTMLElement> | null>(null);

  useFrame((state, delta) => {
    const cam = state.camera;
    progress.current = THREE.MathUtils.damp(progress.current, targetProgress.current, 4, delta);
    const p = progress.current;

    // fly the camera through the wall along Z with a gentle lateral sway
    const endZ = -((count - 1) * SPACING) - END_PAD;
    const z = THREE.MathUtils.lerp(START_Z, endZ, p);
    const swayX = Math.sin(p * Math.PI * 1.35) * 0.85;
    const px = THREE.MathUtils.damp(cam.position.x, swayX + pointer.current.x * 0.5, 5, delta);
    const py = THREE.MathUtils.damp(cam.position.y, 0.2 - pointer.current.y * 0.4, 5, delta);
    cam.position.set(px, py, z);
    lookTarget.set(swayX * 0.35, 0.05, z - 10);
    cam.lookAt(lookTarget);
    // mouse parallax: small extra rotation on top of lookAt
    cam.rotation.y += pointer.current.x * 0.05;
    cam.rotation.x += pointer.current.y * 0.04;

    // fake depth of field: focus/defocus + fade each DOM card by its Z distance to the camera
    const stage = stageRef.current;
    if (!stage) return;
    if (!cachedCards.current || cachedCards.current.length !== count) {
      cachedCards.current = stage.querySelectorAll<HTMLElement>(".cardwall-card");
    }
    const els = cachedCards.current;
    for (let i = 0; i < Math.min(count, els.length); i++) {
      const el = els[i];
      const dist = z - -i * SPACING;
      const nearBlur = THREE.MathUtils.clamp((FOCUS_NEAR - dist) * 2.0, 0, 9);
      const farBlur = THREE.MathUtils.clamp((dist - FOCUS_FAR) * 0.5, 0, 7);
      const blur = Math.max(nearBlur, farBlur);
      const opacity =
        THREE.MathUtils.clamp((dist - 0.8) / 1.2, 0, 1) *
        THREE.MathUtils.clamp((28 - dist) / 8, 0, 1);
      el.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : "";
      el.style.opacity = opacity.toFixed(3);
      el.style.visibility = opacity <= 0.01 ? "hidden" : "visible";
      el.style.pointerEvents = dist > 1.2 && blur < 2.5 ? "auto" : "none";
    }
  });

  return null;
}

/** Background dust field: parallax depth cue while the camera flies through */
function DustField({ color, depth }: { color: string; depth: number }) {
  const positions = useMemo(() => {
    const rand = mulberry32(42);
    const count = 420;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (rand() - 0.5) * 26;
      arr[i * 3 + 1] = (rand() - 0.5) * 16;
      arr[i * 3 + 2] = START_Z + 2 - rand() * (depth + 14);
    }
    return arr;
  }, [depth]);

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.055}
        color={color}
        transparent
        opacity={0.45}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}

/** Read CSS variables so fog / dust colors follow the site theme */
function useThemeColors() {
  const [colors, setColors] = useState({ bg: "#f2f0e4", dot: "#57534e" });

  useEffect(() => {
    const read = () => {
      const cs = getComputedStyle(document.documentElement);
      setColors({
        bg: cs.getPropertyValue("--color-bg").trim() || "#f2f0e4",
        dot: cs.getPropertyValue("--color-text-muted").trim() || "#57534e",
      });
    };
    read();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    mq.addEventListener("change", read);
    return () => {
      obs.disconnect();
      mq.removeEventListener("change", read);
    };
  }, []);

  return colors;
}

export default function CardWall3D({
  items,
  labels,
  outro,
  heading,
  subtitle,
}: {
  items: WallItem[];
  labels: WallLabels;
  outro: WallOutro;
  heading: string;
  subtitle: string;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const introRef = useRef<HTMLDivElement>(null);
  const outroRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const stRef = useRef<ScrollTrigger | null>(null);
  const targetProgress = useRef(0);
  const pointer = useRef({ x: 0, y: 0 });
  const colors = useThemeColors();

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const st = ScrollTrigger.create({
      trigger: sectionRef.current,
      start: "top top",
      end: "bottom bottom",
      onUpdate: (self) => {
        const p = self.progress;
        targetProgress.current = p;
        if (introRef.current) {
          introRef.current.style.opacity = String(Math.max(0, 1 - p * 2.6));
        }
        if (outroRef.current) {
          outroRef.current.style.opacity = String(
            THREE.MathUtils.clamp((p - OUTRO_FROM) / (1 - OUTRO_FROM), 0, 1)
          );
          outroRef.current.style.visibility =
            p > OUTRO_FROM ? "visible" : "hidden";
        }
        if (railRef.current) {
          const active = Math.round(p * (items.length - 1));
          railRef.current.dataset.active = String(active);
          railRef.current
            .querySelectorAll(".cardwall-rail-item")
            .forEach((el, i) => {
              (el as HTMLElement).dataset.on = i <= active ? "1" : "0";
            });
        }
      },
    });
    stRef.current = st;
    const onMove = (e: PointerEvent) => {
      pointer.current.x = e.clientX / window.innerWidth - 0.5;
      pointer.current.y = e.clientY / window.innerHeight - 0.5;
    };
    window.addEventListener("pointermove", onMove);
    return () => {
      st.kill();
      stRef.current = null;
      window.removeEventListener("pointermove", onMove);
    };
  }, [items.length]);

  const jumpTo = (i: number) => {
    const st = stRef.current;
    if (!st) return;
    const p = items.length > 1 ? i / (items.length - 1) : 0;
    window.scrollTo({ top: st.start + (st.end - st.start) * p, behavior: "smooth" });
  };

  const depth = (items.length - 1) * SPACING + END_PAD;

  return (
    <section
      className="cardwall"
      ref={sectionRef}
      style={{ height: `${100 + items.length * 85}vh` }}
    >
      <div className="cardwall-stage" ref={stageRef}>
        <Canvas
          dpr={[1, 1.75]}
          camera={{ fov: FOV, near: 0.1, far: 70, position: [0, 0.2, START_Z] }}
          gl={{ antialias: true, alpha: true }}
        >
          <fog attach="fog" args={[colors.bg, 15, 36]} />
          <DustField color={colors.dot} depth={depth} />
          {items.map((item, i) => {
            const { position, rotation } = cardLayout(i);
            return (
              <Html
                key={item.key}
                transform
                position={position}
                rotation={rotation}
                scale={CARD_SCALE}
                zIndexRange={[40, 0]}
              >
                <article className="card cardwall-card">
                  <span className="cardwall-index" aria-hidden="true">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3>
                    <a
                      href={item.repo}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
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
                      <a
                        href={item.demo}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {labels.demo}
                      </a>
                    )}
                    <a
                      href={item.repo}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {labels.source}
                    </a>
                  </div>
                </article>
              </Html>
            );
          })}
          <Rig
            count={items.length}
            targetProgress={targetProgress}
            pointer={pointer}
            stageRef={stageRef}
          />
        </Canvas>

        <div className="cardwall-intro" ref={introRef}>
          <h1 className="page-title">{heading}</h1>
          <p className="page-subtitle">{subtitle}</p>
          <div className="cardwall-hint" aria-hidden="true">
            ↓ SCROLL
          </div>
        </div>

        <div className="cardwall-outro" ref={outroRef}>
          <h2>{outro.title}</h2>
          <p>{outro.subtitle}</p>
          <div className="hero-cta">
            <a
              className="btn btn--primary"
              href={outro.githubUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {outro.githubCta}
            </a>
            <Link className="btn btn--secondary" href={outro.contactHref}>
              {outro.contactCta}
            </Link>
          </div>
        </div>

        <nav
          className="cardwall-rail"
          ref={railRef}
          aria-label={heading}
        >
          {items.map((item, i) => (
            <button
              key={item.key}
              type="button"
              className="cardwall-rail-item"
              onClick={() => jumpTo(i)}
              aria-label={`${String(i + 1).padStart(2, "0")} ${item.name}`}
            >
              <span className="cardwall-rail-dot" aria-hidden="true" />
              <span className="cardwall-rail-num" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
            </button>
          ))}
        </nav>
      </div>
    </section>
  );
}
