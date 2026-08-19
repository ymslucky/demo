"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";

export default function ImmersiveLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [isNavigating, setIsNavigating] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();

    if (isNavigating) {
      router.push(href);
      return;
    }

    setIsNavigating(true);
    
    // Neo-Brutalism fast exit
    const pageEl = document.querySelector(".page") as HTMLElement;
    if (pageEl) {
      pageEl.style.transition = "transform 0.15s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.15s ease-out";
      pageEl.style.transform = "scale(0.98) translateY(10px)";
      pageEl.style.opacity = "0";
    }

    // Wait for ultra-fast transition
    setTimeout(() => {
      if (pageEl) {
        pageEl.style.transition = "none";
        pageEl.style.transform = "scale(1) translateY(0)";
        pageEl.style.opacity = "1";
      }
      setIsNavigating(false);
      router.push(href);
    }, 150);
  };

  return (
    <a href={href} className={className} onClick={handleClick}>
      {children}
    </a>
  );
}
