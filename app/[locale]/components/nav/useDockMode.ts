import { useEffect } from "react";

/* Morphing Slab scroll state machine: header[data-dock-mode] toggles
   between "slab" (page top) and "capsule" (scrolled), and the reading
   progress is exposed as --scroll-progress (0..1) on the header.
   Both are plain style/attribute mutations - no React re-renders. */
const CAPSULE_THRESHOLD = 24; // px scrolled before the slab collapses

export function useDockMode(
  headerRef: React.RefObject<HTMLElement | null>
) {
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    let raf = 0;
    let mode = "";
    const update = () => {
      raf = 0;
      const y = window.scrollY;
      const next = y > CAPSULE_THRESHOLD ? "capsule" : "slab";
      if (next !== mode) {
        mode = next;
        header.setAttribute("data-dock-mode", next);
      }
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const progress = max > 0 ? Math.min(1, y / max) : 0;
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
