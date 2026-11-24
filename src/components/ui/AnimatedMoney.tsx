"use client";

import { useEffect, useRef, useState } from "react";
import { useTx } from "@/i18n/tx-client";
import { formatMoney } from "@/lib/money";

/** Importe que se anima (cuenta de un valor al otro) cuando cambia; sin animación en la primera pintura ni con prefers-reduced-motion. */
export function AnimatedMoney({ cents, currency = "EUR", className }: { cents: number; currency?: string; className?: string }) {
  const x = useTx();
  const [shown, setShown] = useState(cents);
  const last = useRef(cents);

  useEffect(() => {
    if (last.current === cents) return;
    const from = last.current;
    last.current = cents;
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ms = reduce ? 0 : 550;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = ms === 0 ? 1 : Math.min(1, (now - t0) / ms);
      setShown(Math.round(from + (cents - from) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cents]);

  return <span className={className} aria-label={formatMoney(cents, currency, x.locale)}>{formatMoney(shown, currency, x.locale)}</span>;
}
