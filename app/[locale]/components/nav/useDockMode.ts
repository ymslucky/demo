import { useEffect } from "react";

/* 常驻平板（constant-slab）滚动状态：header 在任何滚动位置都保持
   全宽的底板。超过阈值后只会收紧（CSS 读取
   header[data-scrolled]），阅读进度以
   --scroll-progress（0..1）暴露。两者都是纯 attribute/style 修改 ——
   不触发 React 重渲染。 */
const SCROLLED_THRESHOLD = 24; // 底板收紧前需要滚动的像素数

export function useDockMode(
  headerRef: React.RefObject<HTMLElement | null>
) {
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    let raf = 0;
    let scrolled = false;
    const update = () => {
      raf = 0;
      const next = window.scrollY > SCROLLED_THRESHOLD;
      if (next !== scrolled) {
        scrolled = next;
        header.toggleAttribute("data-scrolled", next);
      }
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const progress = max > 0 ? Math.min(1, window.scrollY / max) : 0;
      header.style.setProperty("--scroll-progress", progress.toFixed(4));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [headerRef]);
}
