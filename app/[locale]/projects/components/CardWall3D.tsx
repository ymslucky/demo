"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
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
  githubCta: string;
  contactCta: string;
  githubUrl: string;
  contactHref: string;
}

/* ============================================================
   Scene params — the single place to tune camera / DOF / fill.

   Architecture (rebuilt after debug session cardwall-card-tiny):
   - The Three.js scene drives ONLY the camera flight and the
     background dust/fog. Cards are NOT drei <Html transform>
     (its hidden 0.025 matrix calibration caused the tiny-card
     bug); instead each frame we project the card's virtual
     world position with camera.project() and write a plain
     CSS transform. Sizes/aspect therefore always match the
     live camera, and card DOM stays crisp & hit-test exact.
   ============================================================ */
const SPACING = 6.4;       // Z distance between cards
const START_Z = 6.5;       // camera start (first card ~80% viewport width)
const END_PAD = 8;         // extra flight room past the last card
const FOV = 55;            // vertical field of view (perspective strength)
const CARD_W_WORLD = 7.2;  // card width in world units (height derives from DOM ratio)
const FOCUS_NEAR = 3.4;    // fake DOF: near focal plane
const FOCUS_FAR = 8.5;     // fake DOF: far focal plane
const FOCUS_FILL = 0.88;   // focused card fills this fraction of viewport width
const FOCUS_FILL_H = 0.82; // ...and at most this fraction of viewport height
const OVERFILL_FROM = 0.9; // viewport-width fraction where flythrough fade starts
const OVERFILL_END = 1.04; // ...fully faded (prevents side clipping)
const OUTRO_FROM = 0.82;   // scroll progress where the outro fades in

/** Virtual world position of card #i (staggered for spatial depth). */
function cardWorld(i: number): [number, number, number] {
  const side = i % 2 === 0 ? -1 : 1;
  const y = [0.12, -0.22, 0.35][i % 3];
  return [side * 0.5, y, -i * SPACING];
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

/** Camera flight + per-frame projection of every card into screen space. */
function Flight({
  count,
  targetProgress,
  pointer,
  focusIndex,
  hoverIndex,
  stageRef,
}: {
  count: number;
  targetProgress: React.RefObject<number>;
  pointer: React.RefObject<{ x: number; y: number }>;
  focusIndex: React.RefObject<number>;
  hoverIndex: React.RefObject<number>;
  stageRef: React.RefObject<HTMLDivElement | null>;
}) {
  const progress = useRef(0);
  const lookAt = useMemo(() => new THREE.Vector3(), []);
  const v = useMemo(() => new THREE.Vector3(), []);
  const tanHalf = useMemo(() => Math.tan(THREE.MathUtils.degToRad(FOV) / 2), []);
  // card DOM nodes are queried lazily once, then cached (avoids per-frame querySelectorAll)
  const cachedCards = useRef<NodeListOf<HTMLElement> | null>(null);

  useFrame((state, delta) => {
    const cam = state.camera;
    const { size } = state;
    progress.current = THREE.MathUtils.damp(progress.current, targetProgress.current, 4, delta);
    const p = progress.current;
    const fi = focusIndex.current;
    const hi = hoverIndex.current;
    const focusing = fi >= 0;

    /* ---- resolve the cached card DOM (needed by both branches below) ---- */
    const stage = stageRef.current;
    if (!stage) return;
    if (!cachedCards.current || cachedCards.current.length !== count) {
      cachedCards.current = stage.querySelectorAll<HTMLElement>(".cardwall-card");
    }
    const cards = cachedCards.current;

    /* ---- camera motion: scroll flight vs. focus glide ---- */
    if (focusing) {
      const [cx, cy, cz] = cardWorld(fi);
      const el = cards[fi];
      // DOM aspect of the focused card (safe: focus switch is rare)
      const ratio = el && el.offsetWidth > 0 ? el.offsetHeight / el.offsetWidth : 0.63;
      const aspect = size.width / size.height;
      const distW = CARD_W_WORLD / 2 / (FOCUS_FILL * tanHalf * aspect);
      const distH = (CARD_W_WORLD * ratio) / 2 / (FOCUS_FILL_H * tanHalf);
      const dist = Math.max(distW, distH);
      cam.position.x = THREE.MathUtils.damp(cam.position.x, cx, 5, delta);
      cam.position.y = THREE.MathUtils.damp(cam.position.y, cy, 5, delta);
      cam.position.z = THREE.MathUtils.damp(cam.position.z, cz + dist, 5, delta);
      lookAt.set(cx, cy, cz);
      cam.lookAt(lookAt);
    } else {
      const endZ = -((count - 1) * SPACING) - END_PAD;
      const z = THREE.MathUtils.lerp(START_Z, endZ, p);
      const swayX = Math.sin(p * Math.PI * 1.35) * 0.3;
      cam.position.x = THREE.MathUtils.damp(cam.position.x, swayX + pointer.current.x * 0.3, 5, delta);
      cam.position.y = THREE.MathUtils.damp(cam.position.y, 0.1 - pointer.current.y * 0.25, 5, delta);
      cam.position.z = z;
      lookAt.set(swayX * 0.35, 0.05, z - 10);
      cam.lookAt(lookAt);
      // subtle mouse parallax on top of lookAt
      cam.rotation.y += pointer.current.x * 0.05;
      cam.rotation.x += pointer.current.y * 0.04;
    }

    /* ---- project every card to screen space (plain DOM, no drei Html) ---- */
    for (let i = 0; i < Math.min(count, cards.length); i++) {
      const el = cards[i];
      if (!el) continue;

      const [cx, cy, cz] = cardWorld(i);
      v.set(cx, cy, cz);
      const dist = cam.position.distanceTo(v);
      v.project(cam);

      const isFocus = focusing && i === fi;
      const isHover = !focusing && i === hi;

      if (v.z > 1 || dist <= 0.05) {
        // behind the camera
        el.style.visibility = "hidden";
        el.style.pointerEvents = "none";
        continue;
      }

      const sx = (v.x * 0.5 + 0.5) * size.width;
      const sy = (-v.y * 0.5 + 0.5) * size.height;
      // projected card width in px (tanHalf is vertical-fov based -> use height)
      const projW = (CARD_W_WORLD / (2 * tanHalf * dist)) * size.height;
      const layoutW = el.offsetWidth;
      if (layoutW <= 0) {
        el.style.visibility = "hidden";
        continue;
      }
      const scale = projW / layoutW;
      const pct = projW / size.width;

      // fake depth of field
      const nearBlur = THREE.MathUtils.clamp((FOCUS_NEAR - dist) * 2.0, 0, 9);
      const farBlur = THREE.MathUtils.clamp((dist - FOCUS_FAR) * 0.5, 0, 7);
      const blur = isFocus || isHover ? 0 : Math.max(nearBlur, farBlur);

      // flythrough fade once the card would clip the viewport sides
      const overfill = THREE.MathUtils.clamp(
        (OVERFILL_END - pct) / (OVERFILL_END - OVERFILL_FROM),
        0,
        1
      );
      const base =
        THREE.MathUtils.clamp((dist - 0.8) / 1.2, 0, 1) *
        THREE.MathUtils.clamp((28 - dist) / 8, 0, 1);
      const opacity = isFocus ? 1 : isHover ? Math.max(base, 0.95) : base * overfill;

      el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -50%) scale(${scale.toFixed(4)})`;
      el.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : "";
      el.style.opacity = opacity.toFixed(3);
      el.style.visibility = opacity <= 0.01 ? "hidden" : "visible";
      el.style.pointerEvents =
        isFocus || isHover || (opacity > 0.2 && pct < 1.0) ? "auto" : "none";
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

  // sync focused state -> rig ref (read imperatively every frame)
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
          camera={{ fov: FOV, near: 0.1, far: 70, position: [0, 0.1, START_Z] }}
          gl={{ antialias: true, alpha: true }}
        >
          <fog attach="fog" args={[colors.bg, 15, 36]} />
          <DustField color={colors.dot} depth={depth} />
          <Flight
            count={items.length}
            targetProgress={targetProgress}
            pointer={pointer}
            focusIndex={focusIndex}
            hoverIndex={hoverIndex}
            stageRef={stageRef}
          />
        </Canvas>

        {/* Screen-space card layer: projected by <Flight> each frame */}
        <div className="cardwall-cards">
          {items.map((item, i) => (
            <article
              key={item.key}
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
          ))}
        </div>

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
