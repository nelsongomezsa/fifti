"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { useTx } from "@/i18n/tx-client";

const SCREENS = ["/inicio", "/movimientos"];
const THRESHOLD = 72;

/** Tirar hacia abajo desde arriba del todo recarga Inicio y Movimientos, como en una app nativa. */
export function PullToRefresh() {
  const x = useTx();
  const path = usePathname();
  const router = useRouter();
  const [pull, setPull] = useState(0);
  const [busy, start] = useTransition();
  const startY = useRef<number | null>(null);
  const active = SCREENS.includes(path);

  useEffect(() => {
    if (!active) return;
    const down = (e: TouchEvent) => { startY.current = window.scrollY <= 0 ? (e.touches[0]?.clientY ?? null) : null; };
    const move = (e: TouchEvent) => {
      if (startY.current === null) return;
      const dy = (e.touches[0]?.clientY ?? 0) - startY.current;
      setPull(dy > 0 ? Math.min(dy * 0.5, 110) : 0);
    };
    const up = () => {
      setPull((p) => { if (p >= THRESHOLD / 2) start(() => router.refresh()); return 0; });
      startY.current = null;
    };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", up);
    return () => { window.removeEventListener("touchstart", down); window.removeEventListener("touchmove", move); window.removeEventListener("touchend", up); };
  }, [active, router]);

  if (!active || (pull === 0 && !busy)) return null;
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 top-[env(safe-area-inset-top)] z-30 flex justify-center" style={{ transform: `translateY(${busy ? 16 : pull / 2}px)` }}>
      <span className="grid size-10 place-items-center rounded-full border border-border bg-surface-2 shadow-lg">
        <svg viewBox="0 0 24 24" width="18" height="18" className={busy ? "animate-spin" : ""} style={{ transform: busy ? undefined : `rotate(${pull * 3}deg)` }} aria-hidden>
          <path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="sr-only">{busy ? x("Actualizando…") : x("Suelta para actualizar")}</span>
      </span>
    </div>
  );
}
