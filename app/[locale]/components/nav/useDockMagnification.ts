import { useEffect, useRef } from "react";
import { navItems } from "./NavIcons";

/* ThreeUI "Animated Top Dock" motion (sable dock):
   gaussian proximity magnification + under-damped spring, applied by
   mutating element styles directly to avoid React re-renders */
const SPRING = 0.19; // spring stiffness
const DAMPING = 0.7; // damping ratio
const SIGMA = 60; // gaussian influence radius (px)
const MAX_GROW = 0.2; // max magnification (+20%)
const MAX_LIFT = -6; // max lift (px); extra shadow drop is computed in CSS via --dock-lift

type ItemRefs = React.RefObject<Array<HTMLAnchorElement | null>>;

export function useDockMagnification(
  dockRef: React.RefObject<HTMLDivElement | null>,
  listRef: React.RefObject<HTMLDivElement | null>,
  itemRefs: ItemRefs
) {
  const springs = useRef(navItems.map(() => ({ s: 0, v: 0, tf: "" })));

  useEffect(() => {
    const dock = dockRef.current;
    const list = listRef.current;
    if (!dock || !list) return;
    // Fine pointers only; respect the user's reduced-motion preference
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let running = false;
    let pointerX: number | null = null;
    let centers: number[] = [];
    let listLeft = 0;

    // offsetLeft/offsetWidth ignore transforms, so they are stable base positions;
    // the container offset is cached too (sticky keeps it fixed while hovered)
    const measure = () => {
      centers = itemRefs.current.map((el) =>
        el ? el.offsetLeft + el.offsetWidth / 2 : 0
      );
      listLeft = list.getBoundingClientRect().left;
    };

    const wake = () => {
      if (!running) {
        running = true;
        // Promote layers only while the motion loop is alive
        list.dataset.dockMoving = "true";
        raf = requestAnimationFrame(tick);
      }
    };

    const tick = () => {
      let active = false;
      itemRefs.current.forEach((el, i) => {
        if (!el) return;
        let target = 0;
        if (pointerX !== null) {
          const d = pointerX - centers[i];
          target = Math.exp(-(d * d) / (2 * SIGMA * SIGMA));
        }
        const sp = springs.current[i];
        sp.v = (sp.v + (target - sp.s) * SPRING) * DAMPING;
        sp.s += sp.v;
        if (target === 0 && Math.abs(sp.s) < 0.002 && Math.abs(sp.v) < 0.002) {
          sp.s = 0;
          sp.v = 0;
        } else {
          active = true;
        }
        const s = sp.s;
        // Skip style writes when the quantized values are unchanged
        const tf = `translateY(${(MAX_LIFT * s).toFixed(2)}px) scale(${(1 + MAX_GROW * s).toFixed(4)})`;
        if (sp.tf !== tf) {
          sp.tf = tf;
          el.style.transform = tf;
          el.style.setProperty("--dock-lift", s.toFixed(3));
        }
        const z = s > 0.02 ? String(10 + Math.round(s * 10)) : "";
        if (el.style.zIndex !== z) el.style.zIndex = z;
      });
      if (active || pointerX !== null) {
        raf = requestAnimationFrame(tick);
      } else {
        running = false;
        delete list.dataset.dockMoving;
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      pointerX = e.clientX - listLeft;
      wake();
    };
    const onPointerEnter = () => {
      measure();
      wake();
    };
    const onResize = () => {
      measure();
    };
    const onPointerLeave = () => {
      pointerX = null;
      wake();
    };
    // Keyboard focus magnifies the focused item (same spring channel as pointer)
    const onFocusIn = (e: FocusEvent) => {
      const idx = itemRefs.current.indexOf(e.target as HTMLAnchorElement);
      if (idx >= 0) {
        measure();
        pointerX = centers[idx];
        wake();
      }
    };
    const onFocusOut = (e: FocusEvent) => {
      if (!dock.contains(e.relatedTarget as Node)) {
        pointerX = null;
        wake();
      }
    };

    dock.addEventListener("pointermove", onPointerMove, { passive: true });
    dock.addEventListener("pointerenter", onPointerEnter);
    dock.addEventListener("pointerleave", onPointerLeave);
    dock.addEventListener("focusin", onFocusIn);
    dock.addEventListener("focusout", onFocusOut);
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      running = false;
      dock.removeEventListener("pointermove", onPointerMove);
      dock.removeEventListener("pointerenter", onPointerEnter);
      dock.removeEventListener("pointerleave", onPointerLeave);
      dock.removeEventListener("focusin", onFocusIn);
      dock.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("resize", onResize);
    };
  }, [dockRef, listRef, itemRefs]);
}
