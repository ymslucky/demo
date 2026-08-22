"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { ExternalLink, Code2, MousePointerClick, ChevronDown } from "lucide-react";
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
  close: string;
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
const FOCUS_FILL = 0.88; // fraction of viewport width the focused card fills
const FOCUS_FILL_H = 0.82; // max fraction of viewport height the focused card fills
const FOCUS_DIST_FALLBACK = 4.4; // used until the card pixel size is measured
const FOCUS_DIST_MIN = 2.5; // clamp so the camera never clips into the card

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

/** Camera rig: scroll flight + mouse parallax + focus mode (fly to a card) + fake DOF */
function Rig({
  count,
  targetProgress,
  pointer,
  stageRef,
  focusIndex,
  hoverIndex,
}: {
  count: number;
  targetProgress: React.RefObject<number>;
  pointer: React.RefObject<{ x: number; y: number }>;
  stageRef: React.RefObject<HTMLDivElement | null>;
  focusIndex: React.RefObject<number>;
  hoverIndex: React.RefObject<number>;
}) {
  const progress = useRef(0);
  const lookTarget = useMemo(() => new THREE.Vector3(), []);
  // card DOM elements are queried lazily once, then cached (avoids per-frame querySelectorAll)
  const cachedCards = useRef<NodeListOf<HTMLElement> | null>(null);

  useFrame((state, delta) => {
    const cam = state.camera;
    progress.current = THREE.MathUtils.damp(progress.current, targetProgress.current, 4, delta);
    const p = progress.current;
    const fi = focusIndex.current;
    const hi = hoverIndex.current;
    const focusing = fi >= 0;

    // resolve the cached card DOM first (the focus branch needs the card pixel size)
    const stage = stageRef.current;
    if (!stage) return;
    if (!cachedCards.current || cachedCards.current.length !== count) {
      cachedCards.current = stage.querySelectorAll<HTMLElement>(".cardwall-card");
    }
    const els = cachedCards.current;

    // effective camera Z (also drives the DOF math below)
    let camZ: number;

    if (focusing) {
      // Focus mode: glide the camera in front of the chosen card, centered.
      // Distance is derived from the card's measured pixel size + viewport
      // aspect so the card always fills FOCUS_FILL of the screen width.
      const { position } = cardLayout(fi);
      let dist = FOCUS_DIST_FALLBACK;
      const focusEl = els?.[fi];
      if (focusEl) {
        const cardW = focusEl.offsetWidth * CARD_SCALE;
        const cardH = focusEl.offsetHeight * CARD_SCALE;
        const aspect = state.size.width / state.size.height;
        const halfTan = Math.tan(THREE.MathUtils.degToRad(FOV) / 2);
        if (cardW > 0 && cardH > 0 && aspect > 0) {
          // fill FOCUS_FILL of the viewport width, but never exceed ~82% of
          // its height (the larger distance wins, so both caps hold)
          const distW = (cardW / 2) / (FOCUS_FILL * halfTan * aspect);
          const distH = (cardH / 2) / (FOCUS_FILL_H * halfTan);
          dist = Math.max(distW, distH);
        }
      }
      dist = Math.max(dist, FOCUS_DIST_MIN);
      camZ = position[2] + dist;
      cam.position.x = THREE.MathUtils.damp(cam.position.x, position[0], 5, delta);
      cam.position.y = THREE.MathUtils.damp(cam.position.y, position[1], 5, delta);
      cam.position.z = THREE.MathUtils.damp(cam.position.z, camZ, 5, delta);
      lookTarget.set(position[0], position[1], position[2]);
      cam.lookAt(lookTarget);
    } else {
      // fly the camera through the wall along Z with a gentle lateral sway
      const endZ = -((count - 1) * SPACING) - END_PAD;
      camZ = THREE.MathUtils.lerp(START_Z, endZ, p);
      const swayX = Math.sin(p * Math.PI * 1.35) * 0.3;
      const px = THREE.MathUtils.damp(cam.position.x, swayX + pointer.current.x * 0.3, 5, delta);
      const py = THREE.MathUtils.damp(cam.position.y, 0.1 - pointer.current.y * 0.25, 5, delta);
      cam.position.set(px, py, camZ);
      lookTarget.set(swayX * 0.35, 0.05, camZ - 10);
      cam.lookAt(lookTarget);
      // mouse parallax: small extra rotation on top of lookAt
      cam.rotation.y += pointer.current.x * 0.05;
      cam.rotation.x += pointer.current.y * 0.04;
    }
    for (let i = 0; i < Math.min(count, els.length); i++) {
      const el = els[i];
      const isFocus = focusing && i === fi;
      const isHover = !focusing && i === hi;
      const dist = camZ - -i * SPACING;
      const nearBlur = THREE.MathUtils.clamp((FOCUS_NEAR - dist) * 2.0, 0, 9);
      const farBlur = THREE.MathUtils.clamp((dist - FOCUS_FAR) * 0.5, 0, 7);
      const blur = isFocus || isHover ? 0 : Math.max(nearBlur, farBlur);
      const opacity =
        THREE.MathUtils.clamp((dist - 0.8) / 1.2, 0, 1) *
        THREE.MathUtils.clamp((28 - dist) / 8, 0, 1);
      el.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : "";
      el.style.opacity = isFocus || isHover ? "1" : opacity.toFixed(3);
      el.style.visibility = opacity <= 0.01 && !isFocus && !isHover ? "hidden" : "visible";
      el.style.pointerEvents = dist > 1.2 && blur < 2.5 ? "auto" : "none";
      el.style.zIndex = isFocus ? "30" : isHover ? "20" : "";
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
  const tipRef = useRef<HTMLDivElement>(null);
  const stRef = useRef<ScrollTrigger | null>(null);
  const targetProgress = useRef(0);
  const pointer = useRef({ x: 0, y: 0 });
  const focusIndex = useRef(-1);
  const hoverIndex = useRef(-1);
  const [focused, setFocused] = useState<number | null>(null);
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
          const fade = String(Math.max(0, 1 - p * 2.6));
          introRef.current.style.opacity = fade;
          if (tipRef.current) tipRef.current.style.opacity = fade;
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocused(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("keydown", onKey);
    return () => {
      st.kill();
      stRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("keydown", onKey);
    };
  }, [items.length]);

  // sync focused state -> rig ref (imperative, read every frame)
  useEffect(() => {
    focusIndex.current = focused === null ? -1 : focused;
  }, [focused]);

  // lock page scroll while a card is centered
  useEffect(() => {
    document.body.style.overflow = focused !== null ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [focused]);

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
                <article
                  className="card cardwall-card"
                  data-focused={focused === i ? "1" : "0"}
                  onPointerEnter={() => {
                    hoverIndex.current = i;
                  }}
                  onPointerLeave={() => {
                    if (hoverIndex.current === i) hoverIndex.current = -1;
                  }}
                  onClick={() => {
                    setFocused((cur) => (cur === i ? null : i));
                  }}
                >
                  <span className="cardwall-index" aria-hidden="true">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3>{item.name}</h3>
                  <div className="tag-list">
                    {item.tags.map((tag) => (
                      <span key={tag} className="tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div className="cardwall-actions">
                    {item.demo && (
                      <a
                        className="cardwall-icon-link"
                        href={item.demo}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={labels.demo}
                        aria-label={`${item.name} ${labels.demo}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink size={22} strokeWidth={2.5} />
                      </a>
                    )}
                    <a
                      className="cardwall-icon-link"
                      href={item.repo}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={labels.source}
                      aria-label={`${item.name} ${labels.source}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Code2 size={22} strokeWidth={2.5} />
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
            focusIndex={focusIndex}
            hoverIndex={hoverIndex}
          />
        </Canvas>

        <div className="cardwall-intro" ref={introRef}>
          <h1 className="page-title">{heading}</h1>
          <p className="page-subtitle">{subtitle}</p>
          <div className="cardwall-hint" aria-hidden="true">
            <ChevronDown size={18} strokeWidth={3} />
          </div>
        </div>
        <div className="cardwall-outro" ref={outroRef}>
          <h2>{outro.title}</h2>
          <div className="hero-cta">
            <a
              className="btn btn--primary"
              href={outro.githubUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Code2 size={20} strokeWidth={2.5} />
              {outro.githubCta}
            </a>
            <Link className="btn btn--secondary" href={outro.contactHref}>
              {outro.contactCta}
            </Link>
          </div>
        </div>

        {focused !== null && (
          <button
            type="button"
            className="cardwall-close"
            onClick={() => setFocused(null)}
            aria-label={labels.close}
          >
            <span aria-hidden="true">×</span>
          </button>
        )}

        <div className="cardwall-tip" ref={tipRef} aria-hidden="true">
          <MousePointerClick size={16} strokeWidth={2.5} />
        </div>

        <nav className="cardwall-rail" ref={railRef} aria-label={heading}>
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
