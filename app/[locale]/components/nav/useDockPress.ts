import { useEffect, useRef } from "react";
import { navItems } from "./NavIcons";

/* Morphing Slab press-key physics: gaussian proximity "presses" the key
   under the pointer (small translateY sink), driven by an under-damped
   spring in a single rAF style-mutation loop to avoid React re-renders.
   Keyboard focus presses through the same spring channel. Disabled
   entirely by prefers-reduced-motion and non-fine pointers. */
const SPRING = 0.19; // spring stiffness
const DAMPING = 0.7; // damping ratio
const SIGMA = 48; // gaussian press radius (px)
const MAX_TRAVEL = 3; // max key travel down (px)

type ItemRefs = React.RefObject<Array<HTMLAnchorElement | null>>;

export function useDockPress(
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

    // offsetLeft/offsetWidth 不受 transform 影响，因此是稳定的基准
    // 位置；容器偏移同样被缓存（sticky 定位使容器在悬停期间
    // 位置保持固定）
    const measure = () => {
      centers = itemRefs.current.map((el) =>
        el ? el.offsetLeft + el.offsetWidth / 2 : 0
      );
      listLeft = list.getBoundingClientRect().left;
    };

    const wake = () => {
      if (!running) {
        running = true;
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
        const tf = `translateY(${(MAX_TRAVEL * s).toFixed(2)}px)`;
        if (sp.tf !== tf) {
          sp.tf = tf;
          el.style.transform = tf;
        }
      });
      if (active || pointerX !== null) {
        raf = requestAnimationFrame(tick);
      } else {
        running = false;
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
    // 键盘焦点会按下聚焦的按键（同一条 spring 通道）
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
