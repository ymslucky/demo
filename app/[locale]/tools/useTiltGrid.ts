import { useEffect, useRef } from "react";

/* Pointer-tilt physics for the tool showcase wall: the card under the
   pointer tilts toward it (rotateX/rotateY) and lifts a few pixels,
   driven by an under-damped spring in a single rAF style-mutation loop
   (zero React renders per frame) — the same feel channel as the nav
   dock press physics. Keyboard focus lifts the focused card through
   the same spring. Disabled entirely by prefers-reduced-motion and
   non-fine pointers. */
const SPRING = 0.14; // spring stiffness
const DAMPING = 0.72; // damping ratio
const MAX_TILT = 6; // max tilt at card edge (deg)
const MAX_LIFT = 5; // max lift (px)
const PERSPECTIVE = 900; // px

type TiltState = {
  rx: number;
  ry: number;
  lift: number;
  vrx: number;
  vry: number;
  vlift: number;
  tf: string;
};

/**
 * 陈列墙的指针倾斜物理。gridRef 是网格容器（需 position:relative），
 * cardRefs 是全部卡片链接的 ref 数组；卡片中心用 offset* 度量 ——
 * 它不受 transform 影响，是稳定基准。容器 rect 在每次指针事件里
 * 实时读取，滚动与布局变化天然正确。
 */
export function useTiltGrid(
  gridRef: React.RefObject<HTMLDivElement | null>,
  cardRefs: React.RefObject<Array<HTMLAnchorElement | null>>
) {
  const states = useRef<TiltState[]>([]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    // 仅精确指针启用；尊重用户的 reduced-motion 偏好
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let running = false;
    let pointer: { x: number; y: number } | null = null;
    let hoverIdx = -1;
    let centers: Array<{ x: number; y: number }> = [];
    // 卸载/重渲染之间 ref 数组可能被替换 —— 在 effect 内固定一份快照
    const cards = cardRefs.current;

    const measure = () => {
      centers = cards.map((el) =>
        el
          ? {
              x: el.offsetLeft + el.offsetWidth / 2,
              y: el.offsetTop + el.offsetHeight / 2,
            }
          : { x: 0, y: 0 }
      );
    };

    const wake = () => {
      if (!running) {
        running = true;
        raf = requestAnimationFrame(tick);
      }
    };

    const tick = () => {
      let active = false;
      for (let i = 0; i < cards.length; i += 1) {
        const el = cards[i];
        if (!el) continue;
        if (!states.current[i]) {
          states.current[i] = {
            rx: 0, ry: 0, lift: 0, vrx: 0, vry: 0, vlift: 0, tf: "",
          };
        }
        const st = states.current[i];
        let trx = 0;
        let tRy = 0;
        let tlift = 0;
        if (pointer !== null && i === hoverIdx && centers[i]) {
          const halfW = Math.max(el.offsetWidth / 2, 1);
          const halfH = Math.max(el.offsetHeight / 2, 1);
          const dx = (pointer.x - centers[i].x) / halfW;
          const dy = (pointer.y - centers[i].y) / halfH;
          tRy = Math.max(-1, Math.min(1, dx)) * MAX_TILT;
          trx = Math.max(-1, Math.min(1, -dy)) * MAX_TILT;
          tlift = MAX_LIFT;
        }
        st.vrx = (st.vrx + (trx - st.rx) * SPRING) * DAMPING;
        st.rx += st.vrx;
        st.vry = (st.vry + (tRy - st.ry) * SPRING) * DAMPING;
        st.ry += st.vry;
        st.vlift = (st.vlift + (tlift - st.lift) * SPRING) * DAMPING;
        st.lift += st.vlift;
        if (
          trx === 0 &&
          Math.abs(st.rx) < 0.02 && Math.abs(st.vrx) < 0.02 &&
          Math.abs(st.ry) < 0.02 && Math.abs(st.vry) < 0.02 &&
          Math.abs(st.lift) < 0.02 && Math.abs(st.vlift) < 0.02
        ) {
          st.rx = 0; st.ry = 0; st.lift = 0;
          st.vrx = 0; st.vry = 0; st.vlift = 0;
        } else {
          active = true;
        }
        // 量化后的字符串未变化时跳过样式写入
        const tf = `perspective(${PERSPECTIVE}px) rotateX(${st.rx.toFixed(2)}deg) rotateY(${st.ry.toFixed(2)}deg) translateY(${(-st.lift).toFixed(2)}px)`;
        if (st.tf !== tf) {
          st.tf = tf;
          el.style.transform = tf;
        }
      }
      if (active || pointer !== null) {
        raf = requestAnimationFrame(tick);
      } else {
        running = false;
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = grid.getBoundingClientRect();
      pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      hoverIdx = -1;
      for (let i = 0; i < cards.length; i += 1) {
        const el = cards[i];
        const c = centers[i];
        if (!el || !c) continue;
        if (
          Math.abs(pointer.x - c.x) <= el.offsetWidth / 2 &&
          Math.abs(pointer.y - c.y) <= el.offsetHeight / 2
        ) {
          hoverIdx = i;
          break;
        }
      }
      wake();
    };
    const onPointerLeave = () => {
      pointer = null;
      hoverIdx = -1;
      wake();
    };
    // 键盘焦点让聚焦的卡片浮起（同一条 spring 通道；指针虚拟置于
    // 卡片中心，tilt 自然为 0）
    const onFocusIn = (e: FocusEvent) => {
      const idx = cards.indexOf(e.target as HTMLAnchorElement);
      if (idx >= 0 && centers[idx]) {
        pointer = { x: centers[idx].x, y: centers[idx].y };
        hoverIdx = idx;
        wake();
      }
    };
    const onFocusOut = (e: FocusEvent) => {
      if (!grid.contains(e.relatedTarget as Node)) {
        pointer = null;
        hoverIdx = -1;
        wake();
      }
    };
    const onResize = () => {
      measure();
    };

    measure();
    grid.addEventListener("pointermove", onPointerMove, { passive: true });
    grid.addEventListener("pointerleave", onPointerLeave);
    grid.addEventListener("focusin", onFocusIn);
    grid.addEventListener("focusout", onFocusOut);
    window.addEventListener("resize", onResize);
    // 入场动画与字体加载会改变卡片尺寸，稍后补测一次基准
    const late = window.setTimeout(measure, 400);

    return () => {
      window.cancelAnimationFrame(raf);
      running = false;
      window.clearTimeout(late);
      grid.removeEventListener("pointermove", onPointerMove);
      grid.removeEventListener("pointerleave", onPointerLeave);
      grid.removeEventListener("focusin", onFocusIn);
      grid.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("resize", onResize);
      // 卸载时清掉 inline transform，避免残留倾斜
      cards.forEach((el) => {
        if (el) el.style.transform = "";
      });
    };
  }, [gridRef, cardRefs]);
}
