import { useEffect } from "react";

/* Immersive scroll: hide the dock while scrolling down, reveal on scroll up
   or when keyboard focus moves into it */
export function useImmersiveHeader(
  headerRef: React.RefObject<HTMLElement | null>
) {
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    let lastY = window.scrollY;
    let raf = 0;
    const update = () => {
      raf = 0;
      const y = window.scrollY;
      const delta = y - lastY;
      lastY = y;
      if (y < 80 || delta < 0) {
        header.removeAttribute("data-dock-hidden");
      } else if (delta > 0) {
        header.setAttribute("data-dock-hidden", "");
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    const onHeaderFocusIn = () => header.removeAttribute("data-dock-hidden");
    window.addEventListener("scroll", onScroll, { passive: true });
    header.addEventListener("focusin", onHeaderFocusIn);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      header.removeEventListener("focusin", onHeaderFocusIn);
    };
  }, [headerRef]);
}
