import { useEffect } from "react";

/* Constant-slab scroll state: the header keeps its full-width plate in
   every scroll position. Past the threshold it only tightens (CSS reads
   header[data-scrolled]) and the reading progress is exposed as
   --scroll-progress (0..1). Both are plain attribute/style mutations -
   no React re-renders. */
const SCROLLED_THRESHOLD = 24; // px scrolled before the plate tightens

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
